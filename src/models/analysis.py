"""Affect and style contract (docs/10 section 6, D-16, R-26).

Estimates are uncertain observations: they change tone and length, never facts.
``confidence`` is optional and uncalibrated -- no invented percentages.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Sentiment = Literal["positive", "neutral", "negative", "uncertain"]
Emotion = Literal["alegría", "tristeza", "enojo", "miedo", "sorpresa", "asco", "neutral", "incierta"]
StateHint = Literal["frustración", "confusión", "satisfacción", "prisa", "interés", "desconocido"]
Method = Literal["text", "voice", "fused"]
StyleName = Literal["directo", "calido", "didactico", "neutro"]
TonePreference = Literal["neutral", "concise", "warm", "explain"]

SENTIMENTS: tuple[str, ...] = ("positive", "neutral", "negative", "uncertain")
EMOTIONS: tuple[str, ...] = ("alegría", "tristeza", "enojo", "miedo", "sorpresa", "asco", "neutral", "incierta")
STATE_HINTS: tuple[str, ...] = ("frustración", "confusión", "satisfacción", "prisa", "interés", "desconocido")


class AffectLabels(BaseModel):
    """One model's answer, validated against the closed lists."""

    sentiment: Sentiment
    emotion: Emotion
    state_hint: StateHint
    cues: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("cues", mode="before")
    @classmethod
    def _trim_cues(cls, v: object) -> object:
        # A fifth or very long cue is not a reason to throw the whole reading away.
        if isinstance(v, list):
            return [str(c).strip()[:80] for c in v if str(c).strip()][:4]
        return v

    @classmethod
    def uncertain(cls) -> AffectLabels:
        return cls(sentiment="uncertain", emotion="incierta", state_hint="desconocido", cues=[])

    @property
    def informative(self) -> bool:
        """False when the model could not estimate anything (``uncertain``/``incierta``)."""
        return self.sentiment != "uncertain" and self.emotion != "incierta"


class AffectEstimate(BaseModel):
    turn_id: str
    state_version: int = 0
    observed_at: str
    sentiment: Sentiment
    emotion: Emotion
    state_hint: StateHint
    method: Method
    discrepancy: bool = False
    text_estimate: AffectLabels | None = None
    voice_estimate: AffectLabels | None = None
    cues: list[str] = Field(default_factory=list)
    confidence: float | None = None


class StyleDecision(BaseModel):
    style: StyleName
    directives: list[str] = Field(default_factory=list)
    reason: str = ""
    source: Literal["preference", "inferred"] = "inferred"
    applies_from_turn: int = 0


class InteractionSignals(BaseModel):
    """Observable facts about the turn, measured by the client (docs/10 section 6).

    The timing fields exist only for a spoken utterance: a typed question sends
    them as null. They are weak cues for the text model, never a label by themselves.
    """

    model_config = ConfigDict(extra="ignore")

    duration_ms: int | None = Field(default=None, ge=0, le=120_000)
    words_per_second: float | None = Field(default=None, ge=0, le=15)
    pause_before_ms: int | None = Field(default=None, ge=0, le=600_000)
    interrupted_agent: bool = False
    repeated_question: bool = False


#: Keys the client sends in ``signals`` (kept in step with web/src/voice/analyst.ts).
SIGNAL_KEYS: tuple[str, ...] = tuple(InteractionSignals.model_fields)


class AffectHistoryItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    turn_id: str | None = None
    sentiment: Sentiment = "uncertain"
    emotion: Emotion = "incierta"
    state_hint: StateHint = "desconocido"
    inferred_style: StyleName | None = None


class UtteranceAnalysisRequest(BaseModel):
    """Body of ``POST /analysis/utterance`` (docs/03, contract .2: JSON, not multipart)."""

    model_config = ConfigDict(extra="forbid")

    turn_id: str = Field(min_length=1, max_length=128)
    state_version: int = Field(default=0, ge=0)
    text: str = Field(min_length=1, max_length=4000)
    t_start: float | None = None
    t_end: float | None = None
    signals: InteractionSignals = Field(default_factory=InteractionSignals)
    affect_history: list[AffectHistoryItem] = Field(default_factory=list, max_length=3)
    tone_preference: TonePreference | None = None
    current_style: StyleDecision | None = None
    turn_index: int = Field(default=0, ge=0)
    voice_consent: bool = False
    audio_wav_b64: str | None = Field(default=None, max_length=4_000_000)


class AnalysisResult(BaseModel):
    affect: AffectEstimate
    style: StyleDecision
    ms: int = 0
