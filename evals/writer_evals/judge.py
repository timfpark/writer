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
            options.update({"temperature": 0, "num_ctx": context_for(case, 1024, info.context_length),
                            "num_predict": 1024})
            try:
                gen = env.runtime.chat(judge.model, template.render(values), options=options,
                                       think=resolve_think("lowest", info), fmt=JUDGE_SCHEMA)
                verdict = json.loads(gen.text)
                scores = {k: int(verdict[k]) for k in CRITERIA}
            except Exception as err:  # a judge failure leaves the item unjudged
                env.log(f"  {result['id']}/{case.id}: judge failed: {str(err)[:120]}")
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
