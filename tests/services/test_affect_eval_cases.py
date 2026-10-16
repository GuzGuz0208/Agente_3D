"""The hand-labelled affect set (tests/fixtures/affect_eval_cases.yaml), offline part.

The labels of the models are checked live (tests/live/test_live_affect.py); here
only what is deterministic: the set is well formed, and the explicit preference
and explicit state detectors find exactly what each case says.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from config import REPO_ROOT
from models.analysis import EMOTIONS, SENTIMENTS, STATE_HINTS
from services.analyst.style import StylePolicy

CASES = yaml.safe_load((Path(__file__).resolve().parents[1] / "fixtures" / "affect_eval_cases.yaml")
                       .read_text(encoding="utf-8"))["cases"]
POLICY = StylePolicy.load(REPO_ROOT / "config" / "style_policy.yaml")


def test_the_set_is_well_formed_and_covers_every_label():
    assert len(CASES) >= 30 and len({c["id"] for c in CASES}) == len(CASES)
    for c in CASES:
        assert set(c["sentiment"]) <= set(SENTIMENTS), c["id"]
        assert set(c["emotion"]) <= set(EMOTIONS), c["id"]
        assert set(c["state_hint"]) <= set(STATE_HINTS), c["id"]
    gold_emotions = {c["emotion"][0] for c in CASES}
    gold_states = {s for c in CASES for s in c["state_hint"]}
    assert set(EMOTIONS) <= gold_emotions
    assert set(STATE_HINTS) <= gold_states


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_explicit_detectors_match_the_labels(case):
    assert POLICY.detect_preference(case["text"]) == case.get("preference")
    assert POLICY.detect_state(case["text"]) == case.get("explicit_state")
