"""A blind scoring sheet for people, and ingestion of the scores they record."""

from __future__ import annotations

import csv
import json
import random
import string
from pathlib import Path
from typing import Dict, List, Optional

from .cases import REQUESTS, Case
from .judge import CRITERIA, _render_output


def build_sheet(paths: List[Path], cases: Dict[str, Case], raw_dir: Path, out_dir: Path,
                case_ids: Optional[List[str]] = None, seed: int = 39) -> int:
    """Write sheet.md, scores.csv, and key.json to out_dir; return the number of outputs."""
    rng = random.Random(seed)
    entries: Dict[str, List[dict]] = {}
    for path in paths:
        result = json.loads(path.read_text(encoding="utf-8"))
        if result.get("kind") != "run":
            continue
        for item in result.get("items", []):
            cid = item.get("case")
            if cid not in cases or (case_ids and cid not in case_ids) or "error" in item:
                continue
            raw = raw_dir / result["id"] / f"{cid}.json"
            if raw.exists():
                text = json.loads(raw.read_text(encoding="utf-8"))["text"]
                entries.setdefault(cid, []).append(
                    {"result": path.name, "config": result["config"]["name"], "text": text})
    out_dir.mkdir(parents=True, exist_ok=True)
    key: Dict[str, dict] = {}
    rows = []
    lines = ["Blind scoring sheet", "", "Score each output from 1 to 5 in scores.csv:",
             "usefulness, grounding, and restraint, as evals/README.md defines them.",
             "Outputs are shuffled within each case and carry no model names.", ""]
    count = 0
    for n, cid in enumerate(sorted(entries), 1):
        case = cases[cid]
        group = entries[cid]
        rng.shuffle(group)
        docs = ", ".join(f"evals/cases/documents/{d.id}.md" for d in case.documents)
        lines += ["=" * 72, f"Case {n}: {cid} ({case.task})", f"Documents: {docs}"]
        if case.request:
            lines.append(f"Request: {REQUESTS[case.request]}")
        if case.selection:
            lines.append(f"Selection: {case.selection}")
        for letter, entry in zip(string.ascii_uppercase, group):
            label = f"{n}{letter}"
            key[label] = {"result": entry["result"], "config": entry["config"], "case": cid}
            rows.append({"label": label, "case": cid, **{c: "" for c in CRITERIA}, "notes": ""})
            lines += ["", "-" * 72, f"Output {label}", "", _render_output(case, entry["text"])]
            count += 1
        lines.append("")
    (out_dir / "sheet.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out_dir / "key.json").write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
    with open(out_dir / "scores.csv", "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["label", "case", *CRITERIA, "notes"])
        writer.writeheader()
        writer.writerows(rows)
    return count


def ingest_scores(sheet_dir: Path, results_dir: Path, scorer: str) -> int:
    """Copy filled scores into the result summaries as a 'human' block; return rows ingested."""
    key = json.loads((sheet_dir / "key.json").read_text(encoding="utf-8"))
    updates: Dict[str, Dict[str, dict]] = {}
    with open(sheet_dir / "scores.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            entry = key.get(row["label"])
            if entry is None:
                raise ValueError(f"scores.csv: unknown label {row['label']!r}")
            if not all((row.get(c) or "").strip() for c in CRITERIA):
                continue
            scores = {c: int(row[c]) for c in CRITERIA}
            if not all(1 <= v <= 5 for v in scores.values()):
                raise ValueError(f"scores.csv: label {row['label']} has a score outside 1 to 5")
            updates.setdefault(entry["result"], {})[entry["case"]] = dict(scores, scorer=scorer)
    total = 0
    for name, by_case in updates.items():
        path = results_dir / name
        result = json.loads(path.read_text(encoding="utf-8"))
        for item in result["items"]:
            if item.get("case") in by_case:
                item["human"] = by_case[item["case"]]
                total += 1
        path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return total
