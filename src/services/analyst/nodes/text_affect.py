"""text_affect: affect from the words, with the D-10 fallback chain fast -> deep.

The chain is hedged, not strictly sequential. Measured on 2026-10-16: while the
fast profile was degraded it answered after the whole 3 s budget (or failed late)
on 22 of 39 utterances, so the deep profile never got time to run and the turn
came back ``uncertain``. Now a failure moves on at once, and a call still pending
after ``hedge_after_s`` gets the next profile beside it: the first valid answer
wins and the others are cancelled.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence

from models.analysis import AffectLabels
from models.ports import AffectModelPort
from services.analyst.state import AnalystState

log = logging.getLogger(__name__)


def make_text_affect(chain: Sequence[AffectModelPort], *,
                     hedge_after_s: float = 1.6) -> Callable[[AnalystState], Awaitable[dict]]:
    async def text_affect(state: AnalystState) -> dict:
        deadline = state["deadline"]
        text, signals = state["req"].text, state.get("signals")
        queue = list(chain)
        running: dict[asyncio.Task[AffectLabels], AffectModelPort] = {}

        def launch() -> None:
            if not queue:
                return
            remaining = deadline.remaining() - 0.1
            if remaining <= 0.2:
                queue.clear()
                return
            model = queue.pop(0)
            task = asyncio.ensure_future(asyncio.wait_for(
                model.estimate(text, None, timeout_s=remaining, signals=signals), timeout=remaining))
            running[task] = model

        try:
            launch()
            while running:
                done, _ = await asyncio.wait(running, timeout=hedge_after_s if queue else None,
                                             return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    launch()  # still pending: hedge with the next profile
                    continue
                for task in done:
                    model = running.pop(task)
                    try:
                        return {"text_labels": task.result(), "text_model": model.name}
                    except Exception as exc:  # noqa: BLE001 -- any failure means "try the next profile"
                        log.warning("text affect via %s failed: %s %s", model.name, type(exc).__name__, exc)
                if not running:
                    launch()
        finally:
            for task in running:
                task.cancel()
            if running:
                await asyncio.gather(*running, return_exceptions=True)
        return {"text_labels": None, "text_model": None}  # -> uncertain, never a stale label

    return text_affect
