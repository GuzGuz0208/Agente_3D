"""Gemini Live credential body (docs/08 sections 3 and 6) with httpx.MockTransport: no network."""

from __future__ import annotations

import json

import httpx

from integrations.realtime.gemini_session import GeminiLiveSession
from models.voice import EngineSetup, RealtimeSessionRequest


def _session(captured: list[dict], **kw) -> GeminiLiveSession:
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={"name": "auth_tokens/abc"})

    return GeminiLiveSession(api_key="k", model="gemini-test", voice="Kore", silence_duration_ms=500,
                             prefix_padding_ms=300, transport=httpx.MockTransport(handler), **kw)


async def _create(session: GeminiLiveSession):
    req = RealtimeSessionRequest(engine="gemini", conversation_id="c")
    setup = EngineSetup(instructions="Eres una IA.", instructions_version="v1", tools=[], voice=None,
                        voice_mode="engine", locale="es-CO")
    return await session.create(req, setup)


async def test_default_leaves_barge_in_to_the_browser():
    captured: list[dict] = []
    grant = await _create(_session(captured))
    ric = captured[0]["bidiGenerateContentSetup"]["realtimeInputConfig"]
    assert ric["activityHandling"] == "NO_INTERRUPTION"
    assert ric["automaticActivityDetection"]["startOfSpeechSensitivity"] == "START_SENSITIVITY_LOW"
    assert grant.config["interruption"] == "client"


async def test_provider_barge_in_can_be_restored():
    captured: list[dict] = []
    grant = await _create(_session(captured, activity_handling="START_OF_ACTIVITY_INTERRUPTS"))
    ric = captured[0]["bidiGenerateContentSetup"]["realtimeInputConfig"]
    assert ric["activityHandling"] == "START_OF_ACTIVITY_INTERRUPTS"
    assert grant.config["interruption"] == "server"


async def test_empty_activity_handling_keeps_the_provider_default():
    captured: list[dict] = []
    grant = await _create(_session(captured, activity_handling=None))
    ric = captured[0]["bidiGenerateContentSetup"]["realtimeInputConfig"]
    assert "activityHandling" not in ric
    assert grant.config["interruption"] == "server"


async def test_context_compression_has_explicit_thresholds():
    """docs/08 section 7.1: a sliding window with explicit trigger and target (not 80 % of 128k)."""
    captured: list[dict] = []
    grant = await _create(_session(captured))
    setup = captured[0]["bidiGenerateContentSetup"]
    assert setup["contextWindowCompression"] == {"triggerTokens": 32000, "slidingWindow": {"targetTokens": 16000}}
    # The voice is stated in every credential, renewals included.
    assert setup["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Kore"
    assert grant.config["voice"] == "Kore"


async def test_context_compression_can_fall_back_to_the_provider_default():
    captured: list[dict] = []
    await _create(_session(captured, compression_trigger_tokens=0))
    assert captured[0]["bidiGenerateContentSetup"]["contextWindowCompression"] == {"slidingWindow": {}}
