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


def _item_prompt(result: Dict, item: Dict) -> str:
    if item.get("prompt"):
        return str(item["prompt"])
    task = item.get("task", "")
    return str(result.get("config", {}).get(task, {}).get("prompt") or task)


def _item_prompt_digest(result: Dict, item: Dict) -> str:
    if item.get("promptDigest"):
        return str(item["promptDigest"])
    task = item.get("task", "")
    prompt_name = _item_prompt(result, item)
    return str(
        result.get("config", {}).get(task, {}).get("promptDigest")
        or result.get("prompts", {}).get(prompt_name, "")
    )


def summarize_run(result: Dict, split: Optional[str] = None,
                  task: Optional[str] = None) -> Optional[Dict[str, object]]:
    raw_items = [
        i for i in result.get("items", [])
        if (split is None or i.get("split") == split)
        and (task is None or i.get("task") == task)
    ]
    if (split is not None or task is not None) and not raw_items:
        return None
    items = [i for i in raw_items if "error" not in i]
    conv = [i for i in items if i["task"] == "conversation"]
    review = [i for i in items if i["task"] == "review"]
    scored = [i["scores"] for i in review]
    valid = [s for s in scored if s.get("valid")]
    planted_total = sum(len(s.get("planted", {})) for s in scored)
    planted_hits = sum(sum(1 for v in s.get("planted", {}).values() if v) for s in scored)
    false_alarms = sum(sum(s.get("falseAlarms", {}).values()) for s in valid)
    anchors = sum(s.get("anchors", 0) for s in valid)
    resolved = sum(s.get("anchorsResolved", 0) for s in valid)
    prompts = sorted({_item_prompt(result, i) for i in raw_items})
    prompt_digests = sorted({d for d in (_item_prompt_digest(result, i) for i in raw_items) if d})

    def by_length(length: str) -> Optional[float]:
        return _median(i.get("totalSeconds") for i in review if i["length"] == length)

    def judged(block: str, only_task: Optional[str] = None) -> Optional[float]:
        scores = [statistics.mean(i[block][c] for c in CRITERIA) for i in items
                  if block in i and (only_task is None or i["task"] == only_task)]
        return _mean(scores)

    model = result["config"]["model"]
    return {
        "config": result["config"]["name"],
        "prompt": ", ".join(prompts) if prompts else "",
        "promptDigest": ", ".join(prompt_digests) if prompt_digests else "",
        "quant": model.get("quantization") or model.get("runner") or "",
        "load": result.get("coldLoadSeconds"),
        "runnerGb": max(((i.get("resources") or {}).get("maxRunnerGb") or 0 for i in items), default=None) or None,
        "ttft": _median(i.get("ttftSeconds") for i in conv),
        "tps": _median(i.get("tokensPerSecond") for i in items),
        "tokensPerReply": _median(i.get("outputTokens") for i in conv),
        "wordsPerReply": _median((i.get("scores") or {}).get("words") for i in conv),
        "scene": by_length("scene"), "chapter": by_length("chapter"), "manuscript": by_length("manuscript"),
        "valid": f"{len(valid)}/{len(scored)}",
        "anchored": (resolved / anchors) if anchors else None,
        "planted": f"{planted_hits}/{planted_total}",
        "falseAlarms": false_alarms,
        "grounded": _mean((i["scores"]["quotesGrounded"] / i["scores"]["quotes"]) for i in conv
                          if i["scores"].get("quotes")),
        "judgeConv": judged("judge", "conversation"), "judgeReview": judged("judge", "review"),
        "watts": _median((i.get("resources") or {}).get("meanWatts") for i in items),
        "errors": len(raw_items) - len(items),
        "hasReview": bool(review),
        "cases": len(items),
    }


def battery_used_wh(result: Dict) -> Optional[float]:
    """Charge drawn from the battery during a run, at the pack's mean voltage."""
    start, end = result.get("chargeStart"), result.get("chargeEnd")
    if not start or not end:
        return None
    return (start["mAh"] - end["mAh"]) * (start["mV"] + end["mV"]) / 2 / 1e6


def report(paths: List[Path], split: Optional[str] = None,
           task: Optional[str] = None) -> str:
    runs, pairs, sustained = [], [], []
    for path in sorted(paths):
        result = json.loads(path.read_text(encoding="utf-8"))
        {"run": runs, "pair": pairs, "sustained": sustained}.get(result.get("kind"), []).append(result)
    sections = []
    if runs:
        summaries = [s for s in (summarize_run(r, split=split, task=task) for r in runs) if s is not None]
        if summaries:
            conv_only = all(not s["hasReview"] for s in summaries)
            if conv_only:
                rows = [
                    [
                        str(s["config"]), str(s["prompt"]), str(s["promptDigest"]),
                        str(s["quant"]), str(s["cases"]), _fmt(s["runnerGb"]),
                        _fmt(s["ttft"]), _fmt(s["tps"]), _fmt(s["tokensPerReply"], 0),
                        _fmt(s["grounded"] * 100 if s["grounded"] is not None else None, 0),
                        _fmt(s["judgeConv"]),
                    ]
                    for s in summaries
                ]
                sections.append(_table(
                    ["Config", "Prompt", "Digest", "Quant", "Cases", "Peak GB", "TTFT s",
                     "Tok/s", "Tok/reply", "Quotes grounded %", "Judge chat"], rows))
            else:
                rows = [
                    [
                        str(s["config"]), str(s["prompt"]), str(s["quant"]),
                        _fmt(s["load"]), _fmt(s["runnerGb"]), _fmt(s["ttft"]),
                        _fmt(s["tps"]), _fmt(s["tokensPerReply"], 0),
                        _fmt(s["scene"], 0), _fmt(s["chapter"], 0), _fmt(s["manuscript"], 0),
                        str(s["valid"]), _fmt(s["anchored"] * 100 if s["anchored"] is not None else None, 0),
                        str(s["planted"]), str(s["falseAlarms"]),
                        _fmt(s["grounded"] * 100 if s["grounded"] is not None else None, 0),
                        _fmt(s["judgeConv"]), _fmt(s["judgeReview"]), _fmt(s["watts"], 0),
                    ]
                    for s in summaries
                ]
                sections.append(_table(
                    ["Config", "Prompt", "Quant", "Load s", "Peak GB", "TTFT s", "Tok/s",
                     "Tok/reply", "Scene s", "Chapter s", "Manuscript s", "Valid", "Anchored %",
                     "Planted", "False alarms", "Quotes grounded %", "Judge chat", "Judge review",
                     "Watts"], rows))
    if pairs and split is None and task is None:
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
    if sustained and split is None and task is None:
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
                _fmt(battery_used_wh(result) if result.get("onBattery") else None),
            ])
        sections.append(_table(["Config", "Minutes", "Reviews", "Mean W", "Max W", "Min CPU speed limit",
                                "Max thermal warning", "Power", "Battery used %", "Battery used Wh"], rows))
    return ("\n\n".join(sections) + "\n") if sections else ""
