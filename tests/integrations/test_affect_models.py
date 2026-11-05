"""OpenAI acoustic affect profile (2026-11-05) with httpx.MockTransport: no network (R-17)."""

from __future__ import annotations

import json

import httpx
import pytest

from integrations.llm.affect_models import AffectModelError, OpenAIAudioAffectModel

LABELS = {"sentiment": "negative", "emotion": "enojo", "state_hint": "frustración", "cues": ["volumen alto"]}


def _model(content: str | None, status: int = 200, seen: list | None = None) -> OpenAIAudioAffectModel:
    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(json.loads(req.content))
        if status != 200:
            return httpx.Response(status, json={"error": {}})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    return OpenAIAudioAffectModel(api_key="k", model="gpt-audio-mini", transport=httpx.MockTransport(handler))


async def test_sends_only_audio_and_parses_the_schema():
    seen: list = []
    labels = await _model(json.dumps(LABELS), seen=seen).estimate("lo que dijo", b"RIFF", timeout_s=3,
                                                                    prosody="ritmo 5 sílabas/s")
    assert labels.sentiment == "negative" and labels.emotion == "enojo"
    body = seen[0]
    assert body["modalities"] == ["text"] and "response_format" not in body  # json_schema is rejected (400)
    user = body["messages"][1]["content"]
    assert user[0]["type"] == "input_audio" and user[0]["input_audio"]["format"] == "wav"
    assert "lo que dijo" not in json.dumps(body, ensure_ascii=False)  # the words have their own branch


async def test_code_fences_are_accepted():
    labels = await _model("```json\n" + json.dumps(LABELS) + "\n```").estimate("", b"RIFF", timeout_s=3)
    assert labels.state_hint == "frustración"


@pytest.mark.parametrize("content,status", [("no es json", 200), ('{"sentiment": "feliz"}', 200), (None, 200), ("", 402)])
async def test_anything_else_is_an_error_not_a_guess(content, status):
    with pytest.raises(AffectModelError):
        await _model(content, status).estimate("", b"RIFF", timeout_s=3)


async def test_text_only_is_refused():
    with pytest.raises(AffectModelError):
        await _model(json.dumps(LABELS)).estimate("hola", None, timeout_s=3)
