"""Summarize result files as Markdown tables for ADRs and pull requests."""

from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .judge import CRITERIA


def _median(values: Iterable[Optional[float]]) -> Optional[float]:
    clean = [v for v in values if isinstance(v, (int, float))]
    return statistics.median(clean) if clean else None


def _mean(values: Iterable[Optional[float]]) -> Optional[float]:
    clean = [v for v in values if isinstance(v, (int, float))]
    return statistics.mean(clean) if clean else None


def _fmt(value: Optional[float], places: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{places}f}"


def _table(header: List[str], rows: List[List[str]]) -> str:
    widths = [max(len(header[i]), *(len(r[i]) for r in rows)) if rows else len(header[i])
              for i in range(len(header))]
    line = lambda cells: "| " + " | ".join(c.ljust(w) for c, w in zip(cells, widths)) + " |"  # noqa: E731
    return "\n".join([line(header), "|" + "|".join("-" * (w + 2) for w in widths) + "|",
                      *(line(r) for r in rows)])


def summarize_run(result: Dict) -> Dict[str, object]:
    items = [i for i in result.get("items", []) if "error" not in i]
    conv = [i for i in items if i["task"] == "conversation"]
    review = [i for i in items if i["task"] == "review"]
    scored = [i["scores"] for i in review]
    valid = [s for s in scored if s.get("valid")]
    planted_total = sum(len(s.get("planted", {})) for s in scored)
    planted_hits = sum(sum(1 for v in s.get("planted", {}).values() if v) for s in scored)
    false_alarms = sum(sum(s.get("falseAlarms", {}).values()) for s in valid)
    anchors = sum(s.get("anchors", 0) for s in valid)
    resolved = sum(s.get("anchorsResolved", 0) for s in valid)

    def by_length(length: str) -> Optional[float]:
        return _median(i.get("totalSeconds") for i in review if i["length"] == length)

    def judged(block: str, task: Optional[str] = None) -> Optional[float]:
        scores = [statistics.mean(i[block][c] for c in CRITERIA) for i in items
                  if block in i and (task is None or i["task"] == task)]
        return _mean(scores)

    model = result["config"]["model"]
    return {
        "config": result["config"]["name"],
        "quant": model.get("quantization") or model.get("runner") or "",
        "load": result.get("coldLoadSeconds"),
        "runnerGb": max(((i.get("resources") or {}).get("maxRunnerGb") or 0 for i in items), default=None) or None,
        "ttft": _median(i.get("ttftSeconds") for i in conv),
        "tps": _median(i.get("tokensPerSecond") for i in items),
        "scene": by_length("scene"), "chapter": by_length("chapter"), "manuscript": by_length("manuscript"),
        "valid": f"{len(valid)}/{len(scored)}",
        "anchored": (resolved / anchors) if anchors else None,
        "planted": f"{planted_hits}/{planted_total}",
        "falseAlarms": false_alarms,
        "grounded": _mean((i["scores"]["quotesGrounded"] / i["scores"]["quotes"]) for i in conv
                          if i["scores"].get("quotes")),
        "judgeConv": judged("judge", "conversation"), "judgeReview": judged("judge", "review"),
        "human": judged("human"),
        "watts": _median((i.get("resources") or {}).get("meanWatts") for i in items),
        "errors": len(result.get("items", [])) - len(items),
    }


def report(paths: List[Path]) -> str:
    runs, pairs, sustained = [], [], []
    for path in sorted(paths):
        result = json.loads(path.read_text(encoding="utf-8"))
        {"run": runs, "pair": pairs, "sustained": sustained}.get(result.get("kind"), []).append(result)
    sections = []
    if runs:
        rows = []
        for result in runs:
            s = summarize_run(result)
            rows.append([
                str(s["config"]), str(s["quant"]), _fmt(s["load"]), _fmt(s["runnerGb"]), _fmt(s["ttft"]),
                _fmt(s["tps"]), _fmt(s["scene"], 0), _fmt(s["chapter"], 0), _fmt(s["manuscript"], 0),
                str(s["valid"]), _fmt(s["anchored"] * 100 if s["anchored"] is not None else None, 0),
                str(s["planted"]), str(s["falseAlarms"]),
                _fmt(s["grounded"] * 100 if s["grounded"] is not None else None, 0),
                _fmt(s["judgeConv"]), _fmt(s["judgeReview"]), _fmt(s["human"]), _fmt(s["watts"], 0),
            ])
        sections.append(_table(
            ["Config", "Quant", "Load s", "Peak GB", "TTFT s", "Tok/s", "Scene s", "Chapter s",
             "Manuscript s", "Valid", "Anchored %", "Planted", "False alarms", "Quotes grounded %",
             "Judge chat", "Judge review", "People", "Watts"], rows))
    if pairs:
        rows = []
        for result in pairs:
            idle = [i for i in result["items"] if i.get("phase") == "idle" and "error" not in i]
            busy = [i for i in result["items"] if i.get("phase") == "duringReview" and "error" not in i]
            reviews = [i for i in result["items"] if i.get("phase") == "review" and "error" not in i]
            rows.append([
                result["config"]["chat"]["name"], result["config"]["reviewer"]["name"],
                "yes" if result.get("bothLoaded") else "no",
                _fmt(max(((i.get("resources") or {}).get("maxRunnerGb") or 0 for i in result["items"]), default=None) or None),
                _fmt(_median(i.get("ttftSeconds") for i in idle)), _fmt(_median(i.get("ttftSeconds") for i in busy)),
                _fmt(_median(i.get("tokensPerSecond") for i in idle)), _fmt(_median(i.get("tokensPerSecond") for i in busy)),
                str(len(reviews)),
            ])
        sections.append(_table(["Chat model", "Reviewer", "Both loaded", "Peak GB", "TTFT idle s",
                                "TTFT during review s", "Tok/s idle", "Tok/s during review", "Reviews"], rows))
    if sustained:
        rows = []
        for result in sustained:
            res = result.get("resources") or {}
            rows.append([
                result["config"]["name"], _fmt(result.get("minutes"), 0), str(len(result.get("items", []))),
                _fmt(res.get("meanWatts")), _fmt(res.get("maxWatts")),
                _fmt(res.get("minCpuSpeedLimit"), 0), _fmt(res.get("maxThermalWarning"), 0),
                "battery" if result.get("onBattery") else "AC",
                _fmt((result["batteryStart"] - result["batteryEnd"]) if result.get("onBattery")
                     and result.get("batteryStart") is not None and result.get("batteryEnd") is not None
                     else None, 0),
            ])
        sections.append(_table(["Config", "Minutes", "Reviews", "Mean W", "Max W", "Min CPU speed limit",
                                "Max thermal warning", "Power", "Battery used %"], rows))
    return "\n\n".join(sections) + "\n"
