"""Fixes from the affect review of 2026-10-16 (docs/10 section 6): fusion, hedged fallback,
interaction signals, silent clips, opaque audio, style rules and their validation."""

from __future__ import annotations

import io
import math
import struct
import time
import wave
from pathlib import Path

import pytest
import yaml

from config import REPO_ROOT
from models.analysis import (
    SIGNAL_KEYS,
    AffectEstimate,
    AffectHistoryItem,
    AffectLabels,
    InteractionSignals,
    StyleDecision,
    UtteranceAnalysisRequest,
)
from services.analyst.graph import AnalystService
from services.analyst.nodes.prepare import describe_signals
from services.analyst.state import AudioClip
from services.analyst.style import StylePolicy
from tests.doubles.fake_voice import FakeAffectModel

POLICY_PATH = REPO_ROOT / "config" / "style_policy.yaml"
POLICY = StylePolicy.load(POLICY_PATH)
CALM = AffectLabels(sentiment="neutral", emotion="neutral", state_hint="interés", cues=["pregunta directa"])
SCARED = AffectLabels(sentiment="negative", emotion="miedo", state_hint="desconocido", cues=["«estoy asustada»"])
ANGRY = AffectLabels(sentiment="negative", emotion="enojo", state_hint="frustración", cues=["tono elevado"])
UNSURE = AffectLabels.uncertain()


def _wav(seconds: float = 2.0, amp: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(amp * math.sin(i / 8))) for i in range(int(16000 * seconds))))
    return buf.getvalue()


def _req(text: str = "¿Cuántas IPS hay?", **kw) -> UtteranceAnalysisRequest:
    return UtteranceAnalysisRequest(turn_id="t1", text=text, **kw)


def _est(**kw) -> AffectEstimate:
    base = {"sentiment": "neutral", "emotion": "neutral", "state_hint": "desconocido"}
    return AffectEstimate(turn_id="t", observed_at="x", method="text", **{**base, **kw})


# -- fusion -------------------------------------------------------------------------


async def test_an_uncertain_voice_does_not_erase_the_text_reading():
    voice = FakeAffectModel("voice", UNSURE, supports_audio=True)
    res = await AnalystService([FakeAffectModel("fast", ANGRY)], voice, POLICY).analyze(_req(voice_consent=True), _wav())
    a = res.affect
    assert voice.calls  # the voice branch did run
    assert (a.method, a.discrepancy, a.emotion) == ("text", False, "enojo")
    assert a.voice_estimate == UNSURE  # still shown for transparency


async def test_words_with_an_emotion_beat_a_neutral_voice_and_flag_it():
    voice = FakeAffectModel("voice", CALM, supports_audio=True)
    res = await AnalystService([FakeAffectModel("fast", SCARED)], voice, POLICY).analyze(_req(voice_consent=True), _wav())
    a = res.affect
    assert (a.method, a.discrepancy, a.emotion, a.sentiment) == ("fused", True, "miedo", "negative")
    assert a.state_hint == "interés"  # the lead had no state: borrowed from the voice


async def test_the_voice_still_leads_when_the_words_are_neutral():
    voice = FakeAffectModel("voice", ANGRY, supports_audio=True)
    res = await AnalystService([FakeAffectModel("fast", CALM)], voice, POLICY).analyze(_req(voice_consent=True), _wav())
    assert (res.affect.emotion, res.affect.discrepancy) == ("enojo", True)


# -- audio handling -----------------------------------------------------------------


async def test_a_silent_or_unreadable_clip_never_reaches_the_voice_model():
    voice = FakeAffectModel("voice", ANGRY, supports_audio=True)
    svc = AnalystService([FakeAffectModel("fast", CALM)], voice, POLICY)
    silent = await svc.analyze(_req(voice_consent=True), _wav(2.0, amp=0))
    garbage = await svc.analyze(_req(voice_consent=True), b"RIFF-not-a-wav")
    assert voice.calls == []
    assert silent.affect.method == garbage.affect.method == "text"


async def test_the_voice_model_gets_audio_but_not_the_transcript():
    voice = FakeAffectModel("voice", CALM, supports_audio=True)
    await AnalystService([FakeAffectModel("fast", CALM)], voice, POLICY).analyze(
        _req("me da miedo", voice_consent=True), _wav())
    assert voice.calls == [("", True)]


def test_the_clip_is_opaque_so_a_trace_cannot_carry_it():
    clip = AudioClip(b"\x01\x02" * 1000)
    assert "bytes, not traced" in repr(clip) and "\\x01" not in repr(clip) and str(clip) == repr(clip)
    assert not hasattr(clip, "__dict__") and len(clip) == 2000 and clip.data.startswith(b"\x01\x02")


# -- hedged fallback ----------------------------------------------------------------


async def test_a_slow_fast_profile_is_hedged_by_the_deep_one_within_the_deadline():
    slow = FakeAffectModel("fast", CALM, delay_s=5.0)
    deep = FakeAffectModel("deep", ANGRY, delay_s=0.1)
    t0 = time.perf_counter()
    res = await AnalystService([slow, deep], None, POLICY, deadline_s=3.0, hedge_after_s=0.3).analyze(_req(), None)
    elapsed = time.perf_counter() - t0
    assert res.affect.text_estimate == ANGRY and res.affect.emotion == "enojo"
    assert elapsed < 1.0 and slow.cancelled == 1  # the loser is cancelled, not left running


async def test_a_failing_fast_profile_moves_on_at_once():
    deep = FakeAffectModel("deep", SCARED)
    t0 = time.perf_counter()
    res = await AnalystService([FakeAffectModel("fast", fail=True), deep], None, POLICY,
                               hedge_after_s=2.0).analyze(_req(), None)
    assert res.affect.emotion == "miedo" and time.perf_counter() - t0 < 0.5


async def test_the_fast_answer_wins_when_it_arrives_before_the_hedge():
    deep = FakeAffectModel("deep", ANGRY)
    res = await AnalystService([FakeAffectModel("fast", CALM, delay_s=0.05), deep], None, POLICY,
                               hedge_after_s=0.5).analyze(_req(), None)
    assert res.affect.text_estimate == CALM and deep.calls == []


# -- interaction signals ------------------------------------------------------------


def test_signal_keys_are_the_contract_with_the_client():
    # web/src/voice/analyst.ts SIGNAL_KEYS sends exactly these (checked there against this file).
    assert SIGNAL_KEYS == ("duration_ms", "words_per_second", "pause_before_ms", "interrupted_agent",
                           "repeated_question")


def test_signals_become_a_short_description_and_typed_turns_have_none():
    spoken = InteractionSignals(duration_ms=2000, pause_before_ms=4000, interrupted_agent=True,
                                repeated_question=True)
    text = describe_signals(spoken, "uno dos tres cuatro cinco seis")
    assert text == ("habló 2.0 s a 3.0 palabras/s; tardó 4 s en responder; interrumpió al asistente; "
                    "repite una pregunta anterior")
    assert describe_signals(InteractionSignals(), "¿Cuántas IPS hay?") is None


async def test_the_text_model_receives_the_signals_and_bad_values_are_rejected():
    fast = FakeAffectModel("fast", CALM)
    await AnalystService([fast], None, POLICY).analyze(
        _req(signals=InteractionSignals(interrupted_agent=True)), None)
    assert fast.signals == ["interrumpió al asistente"]
    with pytest.raises(ValueError):
        InteractionSignals(words_per_second=40)


# -- style policy -------------------------------------------------------------------


def test_fear_or_sadness_gets_warmth_even_when_tagged_as_frustration():
    hist = [AffectHistoryItem(sentiment="negative", emotion="miedo", state_hint="frustración")]
    est = _est(sentiment="negative", emotion="miedo", state_hint="frustración")
    out = POLICY.decide(est, explicit_preference=None, history=hist, current=None, turn_index=2)
    assert out.style == "calido" and out.source == "inferred"


def test_anger_without_a_state_still_leads_to_direct():
    hist = [AffectHistoryItem(sentiment="negative", emotion="enojo", state_hint="desconocido")]
    out = POLICY.decide(_est(sentiment="negative", emotion="enojo"), explicit_preference=None,
                        history=hist, current=None, turn_index=2)
    assert out.style == "directo"


def test_an_uncertain_reading_changes_nothing_and_does_not_count_as_calm():
    current = StyleDecision(style="directo", directives=["x"], reason="r", source="inferred")
    unsure = _est(sentiment="uncertain", emotion="incierta")
    assert POLICY.decide(unsure, explicit_preference=None, history=[], current=current, turn_index=5) == current
    # three uncertain turns in the history do not complete the 4-turn decay to neutral
    hist = [AffectHistoryItem(sentiment="uncertain", emotion="incierta")] * 3
    out = POLICY.decide(_est(), explicit_preference=None, history=hist, current=current, turn_index=6)
    assert out.style == "directo"
    calm = [AffectHistoryItem(sentiment="neutral", emotion="neutral")] * 3
    assert POLICY.decide(_est(), explicit_preference=None, history=calm, current=current,
                         turn_index=6).style == "neutro"


@pytest.mark.parametrize(("text", "pref", "state"), [
    ("No estoy frustrado, solo pregunto", None, None),  # negation
    ("Explícame cuántas IPS hay en Cali", None, None),  # a question, not a style request
    ("Explícame eso paso a paso", "explain", None),
    ("Háblame con más calma", "warm", None),
    ("Dime solo el número, tengo afán", "concise", "prisa"),
    ("Estoy mamado de repetir", None, "frustración"),
    ("¿Me das un resumen?", "concise", None),
    ("presumen que hay más", None, None),  # word start only
])
def test_explicit_detectors(text, pref, state):
    assert (POLICY.detect_preference(text), POLICY.detect_state(text)) == (pref, state)


def test_a_typo_in_the_policy_fails_at_load(tmp_path: Path):
    data = yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8"))
    data["rules"].insert(3, {"when": {"emotion": "tristesa"}, "style": "calido"})
    bad = tmp_path / "policy.yaml"
    bad.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    with pytest.raises(ValueError, match="tristesa"):
        StylePolicy.load(bad)
    data = yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8"))
    data["smoothing"]["decay_turns"] = 6  # the client sends 3 turns: a 6-turn window never completes
    bad.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    with pytest.raises(ValueError, match="smoothing"):
        StylePolicy.load(bad)


def test_cues_are_trimmed_instead_of_rejecting_the_reading():
    labels = AffectLabels.model_validate({"sentiment": "neutral", "emotion": "neutral", "state_hint": "interés",
                                          "cues": ["a", "b", "c", "d", "e", " ", "x" * 200]})
    assert labels.cues == ["a", "b", "c", "d"]
