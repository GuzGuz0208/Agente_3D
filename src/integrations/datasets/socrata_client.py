"""SODA3 adapter for datos.gov.co (D-12). Implements ``DatasetPort``.

Executes queries that ``services/ips`` already built; it never writes SoQL of
its own except the token check. Policy from docs/09 section 2:

- one persistent ``httpx.AsyncClient`` (keep-alive), warmed by the brief;
- connect 4 s / read 4 s per attempt, always clipped to the turn deadline;
- **one** retry on timeout, 5xx or connection error (R-25);
- 429 honours ``Retry-After`` only if it fits the deadline;
- a 403 with a token drops the token and retries once anonymously;
- an API Key (Key ID + Key Secret) goes as HTTP Basic auth; a 401/403 with it drops it
  the same way (datos.gov.co issues API Keys and App Tokens; SODA3 accepts both);
- a 403 without a token (SODA3 ``authentication_required``, seen since 2026-11-05)
  switches this client to the SODA2 fallback ``GET /resource/{id}.json?$query=``
  for the rest of its life (D-12); the trace says ``soda2``;
- in-memory cache: fresh 60 s; an expired entry is served only if the source
  fails, up to 24 h, labelled ``stale`` (docs/09 section 6).
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from models.ips import DatasetUnavailable, Deadline, QueryResult

log = logging.getLogger(__name__)

_RETRYABLE = (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError)


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class SocrataClient:
    def __init__(
        self,
        *,
        base_url: str,
        dataset_id: str,
        app_token: str = "",
        api_key_id: str = "",
        api_key_secret: str = "",
        connect_timeout_s: float = 4.0,
        read_timeout_s: float = 4.0,
        cache_fresh_s: float = 60.0,
        cache_stale_s: float = 24 * 3600.0,
        page_size: int = 1000,
        attempt_budgets_s: tuple[float, float] = (3.5, 2.0),
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        # Two attempts that fit the 6 s foreground deadline: 3.5 s + 2 s (+ margin).
        self._budgets = attempt_budgets_s
        self._last_ok = 0.0
        self._base_url = base_url.rstrip("/")
        self._path = f"/api/v3/views/{dataset_id}/query.json"
        self._path_soda2 = f"/resource/{dataset_id}.json"
        self._soda2 = False  # sticky once SODA3 refuses anonymous access
        self._token = app_token or None
        self._auth = (api_key_id, api_key_secret) if api_key_id and api_key_secret else None
        self._connect_s = connect_timeout_s
        self._read_s = read_timeout_s
        self._fresh_s = cache_fresh_s
        self._stale_s = cache_stale_s
        self._page_size = page_size
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, list[dict[str, Any]], str]] = {}

    @property
    def has_token(self) -> bool:
        return self._token is not None

    @property
    def has_api_key(self) -> bool:
        return self._auth is not None

    @property
    def engine(self) -> str:  # type: ignore[override]
        return "soda2" if self._soda2 else "soda3"

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                transport=self._transport,
                headers={"Accept": "application/json"},
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def warm(self) -> None:
        """Keep the TLS connection warm (a new one costs ~0.3 s, a cold first one up to 2.7 s)."""
        if time.monotonic() - self._last_ok < 15:
            return
        try:
            await self._fetch("SELECT count(*) AS rows", Deadline(3.0))
        except DatasetUnavailable:
            log.info("dataset warm-up failed; the next query pays the connection")

    async def validate_token(self, deadline: Deadline) -> bool:
        """Check the token once at startup; a 403 drops it (never send an invalid one)."""
        if self._token is None:
            return False
        try:
            await self.query("SELECT count(*) AS rows", deadline=deadline, bypass_cache=True)
        except DatasetUnavailable:
            pass  # network trouble is not proof the token is bad; keep it
        return self._token is not None

    async def query(self, soql: str, *, deadline: Deadline, bypass_cache: bool = False) -> QueryResult:
        now = time.monotonic()
        cached = self._cache.get(soql)
        # `<`, not `<=`: with cache_fresh_s=0 nothing is fresh, even on a coarse clock (Windows).
        if cached and not bypass_cache and now - cached[0] < self._fresh_s:
            return QueryResult(rows=cached[1], soql=soql, ms=0, cache_status="fresh", fetched_at=cached[2],
                               engine=self.engine)

        try:
            rows, ms = await self._fetch(soql, deadline)
        except DatasetUnavailable:
            if cached and now - cached[0] <= self._stale_s:
                log.warning("dataset unavailable, serving stale cache")
                return QueryResult(rows=cached[1], soql=soql, ms=0, cache_status="stale", fetched_at=cached[2],
                                   engine=self.engine)
            raise
        fetched_at = _now_iso()
        self._cache[soql] = (time.monotonic(), rows, fetched_at)
        return QueryResult(rows=rows, soql=soql, ms=ms, cache_status="live", fetched_at=fetched_at,
                           engine=self.engine)

    async def _fetch(self, soql: str, deadline: Deadline) -> tuple[list[dict[str, Any]], int]:
        body = {"query": soql, "page": {"pageNumber": 1, "pageSize": self._page_size}}
        attempts, token_dropped, auth_dropped, switched, last_error = 0, False, False, False, "unknown"
        while attempts < 2:
            remaining = deadline.remaining()
            if remaining <= 0.05:
                raise DatasetUnavailable("TIMEOUT", "Foreground deadline exhausted")
            budget = min(self._budgets[min(attempts, len(self._budgets) - 1)], remaining)
            attempts += 1
            headers = {"X-App-Token": self._token} if self._token else {}
            auth = httpx.BasicAuth(*self._auth) if self._auth else None
            timeout = httpx.Timeout(
                connect=min(self._connect_s, budget),
                read=min(self._read_s, budget),
                write=min(self._read_s, budget),
                pool=min(1.0, budget),
            )
            t0 = time.perf_counter()
            try:
                request = (
                    self._http().get(self._path_soda2, params={"$query": soql}, headers=headers, auth=auth,
                                     timeout=timeout)
                    if self._soda2 else
                    self._http().post(self._path, json=body, headers=headers, auth=auth, timeout=timeout)
                )
                r = await asyncio.wait_for(request, timeout=budget)
            except (TimeoutError, *_RETRYABLE) as exc:
                last_error = type(exc).__name__
                continue
            ms = int((time.perf_counter() - t0) * 1000)

            if r.status_code == 200:
                data = r.json()
                self._last_ok = time.monotonic()
                return (data if isinstance(data, list) else []), ms
            if r.status_code in (401, 403) and self._auth and not auth_dropped:
                log.warning("datos.gov.co rejected the API key (HTTP %s); continuing without it", r.status_code)
                self._auth, auth_dropped = None, True
                attempts -= 1
                continue
            if r.status_code == 403 and self._token and not token_dropped:
                log.warning("datos.gov.co rejected the app token; continuing anonymously")
                self._token, token_dropped = None, True
                attempts -= 1  # docs/09 section 11: retry once without it
                continue
            if r.status_code == 403 and not self._token and not self._auth and not self._soda2 and not switched:
                log.warning("datos.gov.co SODA3 requires an app token; using the SODA2 fallback (D-12)")
                self._soda2, switched = True, True
                attempts -= 1  # the switch is not a retry (R-25 counts failures of one endpoint)
                continue
            if r.status_code == 429:
                retry_after = _retry_after(r)
                if retry_after is not None and retry_after < deadline.remaining() - 0.5:
                    await asyncio.sleep(retry_after)
                    continue
                raise DatasetUnavailable("RATE_LIMITED", "datos.gov.co rate limit", retry_after)
            # Eval 2026-10-09: datos.gov.co returned intermittent 4xx for valid queries that
            # succeeded on the next attempt, so any other status gets the one retry too.
            log.warning("datos.gov.co HTTP %s: %s", r.status_code, r.text[:200])
            last_error = f"HTTP {r.status_code}"
            if r.status_code < 500 and attempts >= 2:
                raise DatasetUnavailable("SOURCE_REJECTED", last_error)
        raise DatasetUnavailable("TIMEOUT" if "Timeout" in last_error else "SOURCE_UNAVAILABLE", last_error)


def _retry_after(r: httpx.Response) -> float | None:
    try:
        return float(r.headers.get("Retry-After", ""))
    except ValueError:
        return None
