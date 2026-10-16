"""Deterministic style policy with smoothing (docs/10 section 6, config/style_policy.yaml).

The explicit preference applies immediately and persists; an inferred style
needs two consecutive signals (it must not oscillate) and decays to neutral
after ``decay_turns`` without signals. A reading with no information (both
branches failed) changes nothing. No LLM decides the style (R-04).

The YAML is validated when it loads: a typo in a label or a style name would
otherwise make a rule silently never match.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, get_args

import yaml

from models.analysis import (
    EMOTIONS,
    SENTIMENTS,
    STATE_HINTS,
    AffectEstimate,
    AffectHistoryItem,
    StyleDecision,
    StyleName,
)
from services.ips.normalize import norm

_PREF_TO_STYLE = {"concise": "directo", "warm": "calido", "explain": "didactico"}
_WHEN_VALUES: dict[str, tuple[str, ...]] = {
    "sentiment": SENTIMENTS, "emotion": EMOTIONS, "state_hint": STATE_HINTS,
    "explicit_preference": tuple(_PREF_TO_STYLE),
}
#: The client sends at most 3 previous turns, so smoothing windows longer than 3 + 1 never complete.
_MAX_WINDOW = 4


def _compile(patterns: list[str]) -> re.Pattern[str]:
    """Normalised phrases matched at a word start and not right after «no» («no estoy frustrado»)."""
    alternatives = "|".join(re.escape(norm(p)) for p in patterns if norm(p))
    return re.compile(rf"(?<!\bno )\b(?:{alternatives})") if alternatives else re.compile(r"(?!x)x")


def _validate(styles: dict[str, list[str]], rules: list[dict[str, Any]], min_signals: int, decay_turns: int,
              explicit_patterns: dict[str, list[str]], explicit_state: dict[str, list[str]]) -> None:
    known_styles = set(get_args(StyleName))
    problems = [f"unknown style {s!r}" for s in styles if s not in known_styles]
    problems += [f"style {s!r} of an explicit preference is not defined" for s in _PREF_TO_STYLE.values()
                 if s not in styles]
    for i, rule in enumerate(rules):
        if "default" in rule:
            if rule["default"] not in styles:
                problems.append(f"rule {i}: default style {rule['default']!r} is not defined")
            continue
        if rule.get("style") not in styles:
            problems.append(f"rule {i}: style {rule.get('style')!r} is not defined")
        for key, value in (rule.get("when") or {}).items():
            allowed = _WHEN_VALUES.get(key)
            values = value if isinstance(value, list) else [value]
            if allowed is None:
                problems.append(f"rule {i}: unknown condition {key!r}")
            else:
                problems += [f"rule {i}: {key}={v!r} is not a valid label" for v in values if v not in allowed]
    problems += [f"explicit_patterns: unknown preference {k!r}" for k in explicit_patterns if k not in _PREF_TO_STYLE]
    problems += [f"explicit_state: unknown state {k!r}" for k in explicit_state if k not in STATE_HINTS]
    if not 1 <= min_signals <= _MAX_WINDOW or not 1 <= decay_turns <= _MAX_WINDOW:
        problems.append(f"smoothing windows must be between 1 and {_MAX_WINDOW} turns")
    if problems:
        raise ValueError("invalid style policy: " + "; ".join(problems))


@dataclass
class StylePolicy:
    styles: dict[str, list[str]]
    rules: list[dict[str, Any]]
    min_signals: int
    decay_turns: int
    explicit_patterns: dict[str, list[str]]
    explicit_state: dict[str, list[str]]
    _pref_re: dict[str, re.Pattern[str]] = field(init=False, repr=False)
    _state_re: dict[str, re.Pattern[str]] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        _validate(self.styles, self.rules, self.min_signals, self.decay_turns,
                  self.explicit_patterns, self.explicit_state)
        self._pref_re = {k: _compile(v) for k, v in self.explicit_patterns.items()}
        self._state_re = {k: _compile(v) for k, v in self.explicit_state.items()}

    @classmethod
    def load(cls, path: Path) -> StylePolicy:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        smoothing = data.get("smoothing", {})
        return cls(
            styles={k: v.get("directives", []) for k, v in data["styles"].items()},
            rules=data["rules"],
            min_signals=int(smoothing.get("min_consecutive_signals", 2)),
            decay_turns=int(smoothing.get("decay_turns", 4)),
            explicit_patterns=data.get("explicit_patterns", {}),
            explicit_state=data.get("explicit_state", {}),
        )

    # -- explicit signals in the utterance ------------------------------------

    def detect_preference(self, text: str) -> str | None:
        n = norm(text)
        return next((pref for pref, rx in self._pref_re.items() if rx.search(n)), None)

    def detect_state(self, text: str) -> str | None:
        n = norm(text)
        return next((hint for hint, rx in self._state_re.items() if rx.search(n)), None)

    # -- rules -------------------------------------------------------------------

    def _match(self, labels: dict[str, Any]) -> tuple[str, str]:
        for rule in self.rules:
            if "default" in rule:
                return rule["default"], rule.get("reason", "")
            when = rule["when"]
            if "explicit_preference" in when:
                continue  # handled before inference
            if all(labels.get(k) in v if isinstance(v, list) else labels.get(k) == v for k, v in when.items()):
                return rule["style"], rule.get("reason", "")
        return "neutro", ""

    def inferred_for(self, item: AffectHistoryItem | AffectEstimate) -> str | None:
        """Style a past reading points at; None for a reading with no information."""
        if isinstance(item, AffectHistoryItem) and item.inferred_style:
            return item.inferred_style
        if item.sentiment == "uncertain" and item.emotion == "incierta":
            return None
        return self._match({"sentiment": item.sentiment, "emotion": item.emotion,
                            "state_hint": item.state_hint})[0]

    def _decision(self, style: str, reason: str, source: str, turn_index: int) -> StyleDecision:
        return StyleDecision(style=style, directives=self.styles.get(style, []), reason=reason,  # type: ignore[arg-type]
                             source=source, applies_from_turn=turn_index + 1)  # type: ignore[arg-type]

    def decide(self, affect: AffectEstimate, *, explicit_preference: str | None,
               history: list[AffectHistoryItem], current: StyleDecision | None, turn_index: int) -> StyleDecision:
        # 1) An explicit preference wins and applies from the next turn.
        if explicit_preference in _PREF_TO_STYLE:
            style = _PREF_TO_STYLE[explicit_preference]
            reason = next((r.get("reason", "") for r in self.rules
                           if r.get("when", {}).get("explicit_preference") == explicit_preference), "")
            if current and current.source == "preference" and current.style == style:
                return current
            return self._decision(style, reason, "preference", turn_index)
        # 2) A previous explicit preference persists until the user changes it.
        if current and current.source == "preference":
            return current
        # 3) No information (both branches failed): keep what is in force, do not count it as calm.
        candidate = self.inferred_for(affect)
        if candidate is None:
            return current or self._decision("neutro", "Sin lectura del afecto: estilo neutro", "inferred", turn_index)
        reason = self._match({"sentiment": affect.sentiment, "emotion": affect.emotion,
                              "state_hint": affect.state_hint})[1]
        # 4) Inference with smoothing: two consecutive signals to change.
        current_style = current.style if current else "neutro"
        if candidate == current_style:
            return current or self._decision("neutro", reason, "inferred", turn_index)
        previous = [self.inferred_for(h) for h in history]
        if candidate == "neutro":
            need = self.decay_turns - 1
            recent = previous[-need:] if need > 0 else []
            if len(recent) >= need and all(p == "neutro" for p in recent):
                return self._decision("neutro", reason, "inferred", turn_index)
            return current or self._decision("neutro", reason, "inferred", turn_index)
        streak = 1
        for p in reversed(previous):
            if p != candidate:
                break
            streak += 1
        if streak >= self.min_signals:
            return self._decision(candidate, reason, "inferred", turn_index)
        return current or self._decision("neutro", "Una sola señal: aún no cambio el estilo", "inferred", turn_index)
