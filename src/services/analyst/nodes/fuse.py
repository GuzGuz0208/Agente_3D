"""fuse: deterministic fusion of the text and voice estimates (docs/10 section 6, "Fusión").

- an ``uncertain`` reading counts as missing: it neither leads nor raises a discrepancy;
- both agree -> that label (``fused``);
- they disagree -> ``fused`` + ``discrepancy`` and both are shown. The voice leads
  (tone carries what words omit) except when only the words carry an emotion: a
  calm-sounding voice does not erase "estoy asustada";
- only one available -> that one; none -> ``uncertain`` (never an old label);
- ``state_hint`` comes from the lead, or from the other channel when the lead has none;
- an explicit declaration ("estoy frustrado") beats the inference for ``state_hint``.
"""

from __future__ import annotations

from datetime import UTC, datetime

from models.analysis import AffectEstimate, AffectLabels
from services.analyst.state import AnalystState


def _lead(text: AffectLabels, voice: AffectLabels) -> AffectLabels:
    if voice.emotion == "neutral" and text.emotion != "neutral":
        return text
    return voice


async def fuse(state: AnalystState) -> dict:
    req = state["req"]
    text, voice = state.get("text_labels"), state.get("voice_labels")
    t_ok = text is not None and text.informative
    v_ok = voice is not None and voice.informative
    discrepancy = False
    other: AffectLabels | None = None
    if t_ok and v_ok:
        assert text is not None and voice is not None
        if text.sentiment == voice.sentiment and text.emotion == voice.emotion:
            lead, other = text, voice
        else:
            lead, discrepancy = _lead(text, voice), True
            other = text if lead is voice else voice
        method = "fused"
        cues = list(dict.fromkeys(text.cues + voice.cues))[:6]
    elif t_ok:
        assert text is not None
        lead, method, cues = text, "text", text.cues
    elif v_ok:
        assert voice is not None
        lead, method, cues = voice, "voice", voice.cues
    else:
        lead, method, cues = AffectLabels.uncertain(), "text", []
    inferred_hint = lead.state_hint
    if inferred_hint == "desconocido" and other is not None:
        inferred_hint = other.state_hint
    state_hint = state.get("explicit_state") or inferred_hint
    affect = AffectEstimate(
        turn_id=req.turn_id, state_version=req.state_version,
        observed_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        sentiment=lead.sentiment, emotion=lead.emotion, state_hint=state_hint,  # type: ignore[arg-type]
        method=method, discrepancy=discrepancy,  # type: ignore[arg-type]
        text_estimate=text, voice_estimate=voice, cues=cues, confidence=None,
    )
    return {"affect": affect}
