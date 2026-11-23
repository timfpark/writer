"""Automatic scores: structure, anchoring, planted-issue recall, and false alarms.

These measure what a machine can check. Usefulness is scored by a judge model
and by people on a blind sheet.
"""

from __future__ import annotations

import json
import re
from typing import Dict, List, Optional, Tuple

from .cases import KINDS, Case

QUOTE_SPAN = re.compile(r"[\"\u201c]([^\"\u201c\u201d]{12,400})[\"\u201d]")
MIN_SHARED_WORDS = 5
TRANSLATE = str.maketrans({
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-", "\u00a0": " ",
})


def normalize(text: str) -> str:
    text = text.translate(TRANSLATE).lower()
    text = re.sub(r"[*_`]", "", text)
    return " ".join(text.split())


def _words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9']+", normalize(text))


def resolves(quote: str, text: str) -> bool:
    """Whether a quote appears in the text, allowing ellipses between exact fragments."""
    haystack = normalize(text)
    fragments = [f.strip(" .,;:!?\"'") for f in re.split(r"\.\.\.|\u2026", quote)]
    fragments = [normalize(f) for f in fragments if len(f.split()) >= 2]
    if not fragments:
        return False
    position = 0
    for fragment in fragments:
        found = haystack.find(fragment, position)
        if found < 0:
            return False
        position = found + len(fragment)
    return True


def overlaps(quote: str, passage: str) -> bool:
    """Whether a quoted passage and an expected passage share enough consecutive words."""
    a, b = _words(quote), _words(passage)
    if not a or not b:
        return False
    if " ".join(a) in " ".join(b) or " ".join(b) in " ".join(a):
        return True
    n = min(MIN_SHARED_WORDS, len(a), len(b))
    grams = {tuple(b[i:i + n]) for i in range(len(b) - n + 1)}
    return any(tuple(a[i:i + n]) in grams for i in range(len(a) - n + 1))


def parse_findings(text: str) -> Tuple[Optional[List[dict]], str]:
    """Parse a review reply. Returns (findings, note); findings is None when invalid.

    A valid reply may carry stray text, such as a leaked end-of-turn token,
    after its JSON; the note records that it was ignored.
    """
    body = text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", body, re.S)
    if fenced:
        body = fenced.group(1)
    note = ""
    try:
        data = json.loads(body)
    except json.JSONDecodeError as err:
        start = body.find("{")
        try:
            data, end = json.JSONDecoder().raw_decode(body[start:]) if start >= 0 else (None, 0)
        except json.JSONDecodeError:
            data = None
        if data is None:
            return None, f"not JSON: {err.msg}"
        note = "text outside the JSON was ignored"
    if not isinstance(data, dict) or not isinstance(data.get("findings"), list):
        return None, "missing a 'findings' list"
    findings = []
    for item in data["findings"]:
        if not isinstance(item, dict):
            return None, "a finding is not an object"
        kind, text, passages = item.get("kind"), item.get("text"), item.get("passages")
        if kind not in KINDS or not isinstance(text, str) or not isinstance(passages, list):
            return None, "a finding lacks a valid kind, text, or passages"
        clean = []
        for passage in passages:
            if not isinstance(passage, dict) or not isinstance(passage.get("quote"), str):
                return None, "a passage lacks a quote"
            clean.append({"document": str(passage.get("document", "")), "quote": passage["quote"]})
        findings.append({"kind": kind, "text": text, "passages": clean})
    return findings, note


def score_review(case: Case, text: str) -> Dict[str, object]:
    findings, note = parse_findings(text)
    if findings is None:
        return {"valid": False, "error": note, "findings": 0}
    docs = {d.id: d.text for d in case.documents}
    all_text = "\n".join(docs.values())
    anchors = resolved = 0
    resolved_findings = []
    for finding in findings:
        ok = bool(finding["passages"])
        for passage in finding["passages"]:
            anchors += 1
            target = docs.get(passage["document"], all_text)
            hit = resolves(passage["quote"], target) or resolves(passage["quote"], all_text)
            resolved += hit
            ok = ok and hit
        resolved_findings.append(ok)
    by_kind = {k: sum(1 for f in findings if f["kind"] == k) for k in KINDS}
    matched = {}
    for expected in case.expected:
        matched[expected.id] = any(
            f["kind"] == expected.kind
            and any(overlaps(p["quote"], e) for p in f["passages"] for e in expected.passages)
            and (expected.kind != "disconnect" or _covers_all(f, expected.passages))
            for f in findings
        )
    false_alarms = {k: by_kind[k] for k in case.expect_none}
    return {
        "valid": True,
        "strayText": bool(note),
        "findings": len(findings),
        "byKind": by_kind,
        "anchors": anchors,
        "anchorsResolved": resolved,
        "findingsFullyAnchored": sum(resolved_findings),
        "planted": matched,
        "falseAlarms": false_alarms,
    }


def _covers_all(finding: dict, passages: List[str]) -> bool:
    """A disconnect counts only when it cites both sides of the conflict."""
    return all(any(overlaps(p["quote"], e) for p in finding["passages"]) for e in passages)


def score_conversation(case: Case, text: str) -> Dict[str, object]:
    all_text = "\n".join(d.text for d in case.documents)
    quotes = [q.strip() for q in QUOTE_SPAN.findall(text.translate(TRANSLATE))
              if len(q.split()) >= 3]
    grounded = sum(1 for q in quotes if resolves(q, all_text))
    return {"words": len(text.split()), "quotes": len(quotes), "quotesGrounded": grounded}
