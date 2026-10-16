"""prepare: explicit signals (deterministic), interaction cues and local prosody, before any model call."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from models.analysis import InteractionSignals
from services.analyst import prosody
from services.analyst.state import AnalystState
from services.analyst.style import StylePolicy

#: Below this mean level of the voiced windows the clip is silence: nothing for the voice branch.
_SILENCE_DBFS = -50.0


def describe_signals(signals: InteractionSignals, text: str) -> str | None:
    """Short Spanish description of the interaction cues for the text model, or None when there are none."""
    parts: list[str] = []
    if signals.duration_ms:
        wps = signals.words_per_second
        if wps is None and signals.duration_ms >= 300:
            wps = len(text.split()) / (signals.duration_ms / 1000)
        parts.append(f"habló {signals.duration_ms / 1000:.1f} s" + (f" a {wps:.1f} palabras/s" if wps else ""))
    if signals.pause_before_ms is not None and signals.pause_before_ms >= 3000:
        parts.append(f"tardó {signals.pause_before_ms / 1000:.0f} s en responder")
    if signals.interrupted_agent:
        parts.append("interrumpió al asistente")
    if signals.repeated_question:
        parts.append("repite una pregunta anterior")
    return "; ".join(parts) or None


def make_prepare(policy: StylePolicy) -> Callable[[AnalystState], Awaitable[dict]]:
    async def prepare(state: AnalystState) -> dict:
        req = state["req"]
        audio = state.get("audio") if req.voice_consent else None  # R-26: no consent, no voice analysis
        p = prosody.measure(audio.data, req.text) if audio else None
        # docs/10 "Fusión": an unreadable clip, one under 1 s or pure silence -> text only.
        if p is None or p.duration_s < 1.0 or p.rms_dbfs < _SILENCE_DBFS:
            audio, p = None, None
        return {
            "audio": audio,
            "prosody": p.describe() if p else None,
            "signals": describe_signals(req.signals, req.text),
            "explicit_preference": policy.detect_preference(req.text) or req.tone_preference,
            "explicit_state": policy.detect_state(req.text),
        }

    return prepare
