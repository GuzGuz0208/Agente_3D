"""Live affect evaluation against the real models (docs/10 sections 5 and 6).

Unlike the other live probes this one calls paid providers (Gemini, OpenAI), so it
needs a second switch on top of KOGNIA_LIVE and the two API keys in ``.env``::

    KOGNIA_LIVE=1 KOGNIA_LIVE_AFFECT=1 pytest tests/live/test_live_affect.py -s

About 50 short text calls. Thresholds come from the run of 2026-10-16 (prompt
affect-v2: 36-38/39 on the main set, 10/10 on the held-out set) with some margin
for the models' variance.
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import pytest
import yaml

from config import get_settings
from integrations.llm.affect_models import GeminiAffectModel, OpenAIAffectModel
from models.analysis import UtteranceAnalysisRequest
from services.analyst.graph import AnalystService
from services.analyst.style import StylePolicy

CASES = yaml.safe_load((Path(__file__).resolve().parents[1] / "fixtures" / "affect_eval_cases.yaml")
                       .read_text(encoding="utf-8"))["cases"]
NEGATIVE_EMOTIONS = {"tristeza", "miedo", "enojo", "asco"}

pytestmark = pytest.mark.skipif(os.environ.get("KOGNIA_LIVE_AFFECT") != "1",
                                reason="llama a proveedores de pago: exporta KOGNIA_LIVE_AFFECT=1")


async def test_affect_labels_on_the_hand_labelled_set():
    s = get_settings()
    if not (s.gemini_api_key and s.openai_api_key):
        pytest.skip("faltan GEMINI_API_KEY u OPENAI_API_KEY")
    fast = GeminiAffectModel(api_key=s.gemini_api_key, model=s.analyst_fast_model)
    deep = OpenAIAffectModel(api_key=s.openai_api_key, model=s.analyst_deep_model)
    svc = AnalystService([fast, deep], None, StylePolicy.load(s.style_policy_path),
                         deadline_s=s.analyst_deadline_s, hedge_after_s=s.analyst_hedge_s)
    sem = asyncio.Semaphore(3)

    async def one(case: dict) -> tuple[dict, object, int]:
        async with sem:
            t0 = time.perf_counter()
            res = await svc.analyze(UtteranceAnalysisRequest(turn_id=case["id"], text=case["text"]), None)
            return case, res.affect, int((time.perf_counter() - t0) * 1000)

    try:
        rows = await asyncio.gather(*(one(c) for c in CASES))
    finally:
        await fast.aclose()
        await deep.aclose()

    def ok(case: dict, a) -> bool:
        return a.sentiment in case["sentiment"] and a.emotion in case["emotion"] and a.state_hint in case["state_hint"]

    main = [(c, a) for c, a, _ in rows if not c.get("holdout")]
    held = [(c, a) for c, a, _ in rows if c.get("holdout")]
    for c, a, ms in rows:
        print(f"{'ok' if ok(c, a) else 'xx'} {c['id']:20s} {ms:5d} ms {a.sentiment}/{a.emotion}/{a.state_hint}")
    assert sum(ok(c, a) for c, a in main) >= 0.85 * len(main)
    assert sum(ok(c, a) for c, a in held) >= 0.8 * len(held)
    # The topic is not the speaker's emotion: a data question about cancer or deaths is not sadness.
    topic = [(c["id"], a.emotion) for c, a in main if c["group"] == "consulta" and a.emotion in NEGATIVE_EMOTIONS]
    assert topic == []
    latencies = sorted(ms for _, _, ms in rows)
    assert latencies[int(0.95 * (len(latencies) - 1))] < s.analyst_deadline_s * 1000 + 200
