"""State that travels between the analyst's nodes. The server keeps none of it (R-26)."""

from __future__ import annotations

from typing import TypedDict

from models.analysis import AffectEstimate, AffectLabels, StyleDecision, UtteranceAnalysisRequest
from models.ips import Deadline


class AudioClip:
    """The consented WAV clip, opaque on purpose.

    LangGraph hands node inputs to LangSmith when tracing is on, and LangSmith
    serialises ``bytes`` as base64: a raw clip in the state would leave the server
    in every trace (R-26, docs/10 section 8). This holder has no ``__dict__`` and
    prints only its size, so a trace shows ``<audio clip: N bytes, not traced>``.
    """

    __slots__ = ("_data",)

    def __init__(self, data: bytes) -> None:
        self._data = data

    @property
    def data(self) -> bytes:
        return self._data

    def __len__(self) -> int:
        return len(self._data)

    def __repr__(self) -> str:
        return f"<audio clip: {len(self._data)} bytes, not traced>"

    __str__ = __repr__


class AnalystState(TypedDict, total=False):
    req: UtteranceAnalysisRequest
    audio: AudioClip | None
    deadline: Deadline
    prosody: str | None
    signals: str | None
    explicit_preference: str | None
    explicit_state: str | None
    text_labels: AffectLabels | None
    text_model: str | None
    voice_labels: AffectLabels | None
    voice_model: str | None
    affect: AffectEstimate
    style: StyleDecision
