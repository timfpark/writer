"""Score outputs with a judge model, blind to which configuration produced them."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

from .cases import Case
from .prompts import JUDGE_SCHEMA, case_values
from .runner import Config, Environment, context_for, resolve_think
from .scoring import parse_findings

CRITERIA = ("usefulness", "grounding", "restraint")


def rescore(env: Environment, paths: List[Path], cases: Dict[str, Case]) -> int:
    """Recompute automatic scores from raw output, after the scoring rules change."""
    from .scoring import score_conversation, score_review

    count = 0
    for path in paths:
        result = json.loads(path.read_text(encoding="utf-8"))
        for item in result.get("items", []):
            case = cases.get(item.get("case"))
            raw = env.raw_dir / result["id"] / f"{item.get('case')}.json"
            if case is None or "error" in item or not raw.exists():
                continue
            text = json.loads(raw.read_text(encoding="utf-8"))["text"]
            item["scores"] = score_review(case, text) if case.task == "review" else score_conversation(case, text)
            count += 1
        result.setdefault("cases", {})["scoredWith"] = env.cases_digest
        path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return count


def _render_output(case: Case, text: str) -> str:
    if case.task != "review":
        return text.strip()
    findings, _ = parse_findings(text)
    if findings is None:
        return text.strip() or "(no findings)"
    if not findings:
        return "(no findings)"
    lines = []
    for n, finding in enumerate(findings, 1):
        quotes = "; ".join(f'"{p["quote"]}" ({p["document"]})' for p in finding["passages"])
        lines.append(f"{n}. [{finding['kind']}] {finding['text']}\n   Passages: {quotes}")
    return "\n".join(lines)


def judge_results(env: Environment, judge: Config, paths: List[Path], cases: Dict[str, Case],
                  force: bool = False) -> int:
    """Add a 'judge' block to every scorable item; return how many items were judged."""
    info = env.runtime.info(judge.model)
    env.runtime.unload_all()
    env.runtime.load(judge.model)
    judged = 0
    for path in paths:
        result = json.loads(path.read_text(encoding="utf-8"))
        if result.get("kind") != "run":
            continue
        changed = False
        for item in result.get("items", []):
            case = cases.get(item.get("case"))
            if case is None or "error" in item or "outputDigest" not in item:
                continue
            if not force and item.get("judge", {}).get("model") == judge.model:
                continue
            raw = env.raw_dir / result["id"] / f"{case.id}.json"
            if not raw.exists():
                env.log(f"  {result['id']}/{case.id}: raw output missing, skipped")
                continue
            text = json.loads(raw.read_text(encoding="utf-8"))["text"]
            template = env.templates[f"judge-{case.task}"]
            values = dict(case_values(case), output=_render_output(case, text))
            options = dict(judge.task("review")["options"])
            # The judge's tokenizer may count more tokens than the candidate's, so
            # leave generous room for the documents, the output, and the verdict.
            # Its light reasoning counts against num_predict, so leave room for both.
            options.update({"temperature": 0, "num_ctx": context_for(case, 8192, info.context_length),
                            "num_predict": 4096})
            verdict, error = None, ""
            for _ in range(2):
                try:
                    gen = env.runtime.chat(judge.model, template.render(values), options=options,
                                           think=resolve_think("lowest", info), fmt=JUDGE_SCHEMA)
                    body = gen.text.strip()
                    verdict = json.JSONDecoder().raw_decode(body[body.find("{"):])[0]
                    scores = {k: int(verdict[k]) for k in CRITERIA}
                    break
                except Exception as err:  # retried once; a second failure leaves the item unjudged
                    verdict, error = None, str(err)[:120]
            if verdict is None:
                env.log(f"  {result['id']}/{case.id}: judge failed: {error}")
                continue
            item["judge"] = dict(scores, model=judge.model, digest=info.digest[:12],
                                 prompt=template.digest)
            note = env.raw_dir / result["id"] / f"{case.id}.judge.json"
            note.write_text(json.dumps(verdict, indent=2) + "\n", encoding="utf-8")
            judged += 1
            changed = True
            env.log(f"  {result['id']}/{case.id}: {scores}")
        if changed:
            path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return judged
