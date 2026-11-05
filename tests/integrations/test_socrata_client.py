"""SocrataClient policy (docs/09 sections 2, 6, 11) with httpx.MockTransport: no network (R-17)."""

from __future__ import annotations

import base64

import httpx
import pytest

from integrations.datasets.socrata_client import SocrataClient
from models.ips import DatasetUnavailable, Deadline


def _client(handler, **kw) -> SocrataClient:
    return SocrataClient(base_url="https://example.test", dataset_id="s2ru-bqt6",
                         transport=httpx.MockTransport(handler), **kw)


async def test_ok_then_fresh_cache_then_bypass():
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        return httpx.Response(200, json=[{"value": "9320"}])

    c = _client(handler, app_token="tok")
    first = await c.query("SELECT 1", deadline=Deadline(5))
    second = await c.query("SELECT 1", deadline=Deadline(5))
    third = await c.query("SELECT 1", deadline=Deadline(5), bypass_cache=True)
    assert (first.cache_status, second.cache_status, third.cache_status) == ("live", "fresh", "live")
    assert len(calls) == 2 and calls[0].headers["X-App-Token"] == "tok"
    assert calls[0].url.path == "/api/v3/views/s2ru-bqt6/query.json"


async def test_invalid_token_is_dropped_and_retried_anonymously():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.headers.get("X-App-Token"))
        if req.headers.get("X-App-Token"):
            return httpx.Response(403, json={"code": "permission_denied"})
        return httpx.Response(200, json=[{"value": "1"}])

    c = _client(handler, app_token="bad")
    res = await c.query("SELECT 1", deadline=Deadline(5))
    assert res.rows == [{"value": "1"}] and seen == ["bad", None] and not c.has_token


async def test_one_retry_on_5xx_then_unavailable():
    n = {"calls": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        n["calls"] += 1
        return httpx.Response(503)

    with pytest.raises(DatasetUnavailable) as exc:
        await _client(handler).query("SELECT 1", deadline=Deadline(5))
    assert n["calls"] == 2 and exc.value.code == "SOURCE_UNAVAILABLE"  # R-25: exactly one retry


async def test_stale_cache_only_when_the_source_fails():
    state = {"up": True}

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"value": "9"}]) if state["up"] else httpx.Response(500)

    c = _client(handler, cache_fresh_s=0)
    await c.query("SELECT 1", deadline=Deadline(5))
    state["up"] = False
    res = await c.query("SELECT 1", deadline=Deadline(5))
    assert res.cache_status == "stale" and res.rows == [{"value": "9"}]


async def test_intermittent_4xx_is_retried_once():  # eval 2026-10-09: SOURCE_REJECTED that recovered
    n = {"calls": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        n["calls"] += 1
        return httpx.Response(400) if n["calls"] == 1 else httpx.Response(200, json=[{"value": "7"}])

    res = await _client(handler).query("SELECT 1", deadline=Deadline(5))
    assert res.rows == [{"value": "7"}] and n["calls"] == 2


async def test_429_without_room_in_deadline_is_rate_limited():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "30"})

    with pytest.raises(DatasetUnavailable) as exc:
        await _client(handler).query("SELECT 1", deadline=Deadline(5))
    assert exc.value.code == "RATE_LIMITED" and exc.value.retry_after_s == 30


async def test_two_attempts_fit_the_six_second_deadline():
    import asyncio
    import time

    async def slow(req: httpx.Request) -> httpx.Response:
        await asyncio.sleep(10)
        return httpx.Response(200, json=[])

    c = _client(slow, attempt_budgets_s=(0.3, 0.2))
    t0 = time.monotonic()
    with pytest.raises(DatasetUnavailable):
        await c.query("SELECT 1", deadline=Deadline(6))
    assert time.monotonic() - t0 < 1.0  # 0.3 + 0.2, never 2 x 4 s


async def test_warm_skips_when_recently_used():
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=[{"rows": "1"}])

    c = _client(handler)
    await c.warm()
    await c.warm()
    assert len(calls) == 1


async def test_exhausted_deadline_does_not_call():
    def handler(req: httpx.Request) -> httpx.Response:
        raise AssertionError("must not be called")

    with pytest.raises(DatasetUnavailable):
        await _client(handler).query("SELECT 1", deadline=Deadline(0))


async def test_soda3_without_token_falls_back_to_soda2_and_stays_there():
    # 2026-11-05: datos.gov.co started answering SODA3 anonymously with 403
    # authentication_required; SODA2 (GET /resource) still answers (D-12 fallback).
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.url.path, req.url.params.get("$query")))
        if req.url.path.startswith("/api/v3/"):
            return httpx.Response(403, json={"code": "authentication_required"})
        return httpx.Response(200, json=[{"rows": "41427"}])

    c = _client(handler)
    first = await c.query("SELECT count(*) AS rows", deadline=Deadline(5))
    second = await c.query("SELECT 2", deadline=Deadline(5))
    assert first.rows == [{"rows": "41427"}] and first.engine == "soda2" and second.engine == "soda2"
    assert seen == [
        ("POST", "/api/v3/views/s2ru-bqt6/query.json", None),
        ("GET", "/resource/s2ru-bqt6.json", "SELECT count(*) AS rows"),
        ("GET", "/resource/s2ru-bqt6.json", "SELECT 2"),  # no more SODA3 round-trips
    ]


async def test_invalid_token_then_soda3_403_ends_on_soda2():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.headers.get("X-App-Token")))
        if req.method == "POST":
            return httpx.Response(403, json={"code": "permission_denied" if req.headers.get("X-App-Token") else
                                             "authentication_required"})
        return httpx.Response(200, json=[{"value": "1"}])

    c = _client(handler, app_token="bad")
    res = await c.query("SELECT 1", deadline=Deadline(5))
    assert res.rows == [{"value": "1"}] and res.engine == "soda2" and not c.has_token
    assert seen == [("POST", "bad"), ("POST", None), ("GET", None)]


async def test_valid_token_keeps_soda3():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "POST" and req.headers["X-App-Token"] == "good"
        return httpx.Response(200, json=[{"value": "1"}])

    res = await _client(handler, app_token="good").query("SELECT 1", deadline=Deadline(5))
    assert res.engine == "soda3"


async def test_api_key_goes_as_basic_auth_and_keeps_soda3():
    # datos.gov.co "API Key" (Key ID + Key Secret) authenticates SODA3 with HTTP Basic (2026-11-05).
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.headers.get("Authorization"), req.headers.get("X-App-Token")))
        return httpx.Response(200, json=[{"value": "1"}])

    c = _client(handler, api_key_id="keyid", api_key_secret="secret")
    res = await c.query("SELECT 1", deadline=Deadline(5))
    assert res.engine == "soda3" and c.has_api_key
    method, auth, token = seen[0]
    assert method == "POST" and auth == "Basic " + base64.b64encode(b"keyid:secret").decode() and token is None


async def test_rejected_api_key_is_dropped_then_soda2():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, bool(req.headers.get("Authorization"))))
        if req.method == "POST":
            return httpx.Response(401 if req.headers.get("Authorization") else 403, json={})
        return httpx.Response(200, json=[{"value": "1"}])

    c = _client(handler, api_key_id="keyid", api_key_secret="bad")
    res = await c.query("SELECT 1", deadline=Deadline(5))
    assert res.engine == "soda2" and not c.has_api_key
    assert seen == [("POST", True), ("POST", False), ("GET", False)]
