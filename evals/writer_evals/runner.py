"""Run a configuration over cases and write a committed result summary.

Raw model output goes to the ignored raw folder; the summary keeps only
measurements, scores, and digests, so it stays small and reviewable.
"""

from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import secrets
import subprocess
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import monitor
from .cases import Case, tree_digest
from .prompts import REVIEW_SCHEMA, Template, case_values
from .scoring import score_conversation, score_review

SCHEMA_VERSION = 1
CONTEXTS = (8192, 16384, 32768, 65536, 131072)
TOKENS_PER_WORD = 1.5
PROMPT_OVERHEAD = 1500


class ConfigError(Exception):
    pass


@dataclass
class Config:
    name: str
    runtime: str
    model: str
    hypothesis: str = ""
    options: Dict[str, Any] = field(default_factory=dict)
    tasks: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def task(self, task: str) -> Dict[str, Any]:
        """The think setting and options for one task, defaults merged under overrides."""
        settings = copy.deepcopy(self.tasks.get(task, {}))
        options = dict(self.options)
        options.update(settings.get("options", {}))
        settings["options"] = options
        return settings


def _merge(base: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def load_configs(path: Path) -> Dict[str, Config]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise ConfigError(f"{path}: {err}") from None
    defaults = data.get("defaults", {})
    configs: Dict[str, Config] = {}
    for raw in data.get("configs", []):
        merged = _merge(defaults, raw)
        name = merged.get("name")
        if not name or name in configs:
            raise ConfigError(f"{path}: each config needs a unique 'name' (got {name!r})")
        if not merged.get("model") or merged.get("runtime") not in ("ollama", "fake"):
            raise ConfigError(f"{path}: config '{name}' needs a 'model' and runtime 'ollama'")
        configs[name] = Config(
            name=name, runtime=merged["runtime"], model=merged["model"],
            hypothesis=merged.get("hypothesis", ""), options=merged.get("options", {}),
            tasks={t: merged.get(t, {}) for t in ("conversation", "review")},
        )
    return configs


def resolve_think(requested: Any, info: Any) -> Any:
    """Map 'lowest' and 'highest' onto the levels the model offers; None omits the setting.

    A named level is preferred over False for 'lowest', because some models
    still reason with thinking off but hide it, which only delays the reply.
    """
    levels = list(getattr(info, "thinking", []) or [])
    if requested not in ("lowest", "highest"):
        return requested if levels or requested is None else None
    if not levels:
        return None
    named = [v for v in levels if isinstance(v, str)]
    if requested == "lowest":
        return named[0] if named else False
    return "high" if "high" in named else (named[-1] if named else True)


def context_for(case: Case, num_predict: int, limit: Optional[int] = None) -> int:
    needed = int(case.words * TOKENS_PER_WORD) + PROMPT_OVERHEAD + num_predict
    for size in CONTEXTS:
        if size >= needed and (limit is None or size <= limit):
            return size
    return limit or CONTEXTS[-1]


def git_commit(root: Path) -> str:
    try:
        head = subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], cwd=root,
                              capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "evals", ":!evals/results"], cwd=root,
                               capture_output=True, text=True, check=True).stdout.strip()
        return head + ("-dirty" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return ""


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _round(value: Optional[float], places: int = 2) -> Optional[float]:
    return round(value, places) if isinstance(value, (int, float)) else None


@dataclass
class Environment:
    """Everything a run needs besides the configuration and cases."""

    runtime: Any
    templates: Dict[str, Template]
    cases_digest: str
    results_dir: Path
    raw_dir: Path
    repo_root: Path
    sampler: Callable[[], Any] = monitor.Sampler
    machine: Callable[[], Dict] = monitor.machine
    log: Callable[[str], None] = print


def _header(env: Environment, kind: str, slug: str) -> Dict[str, Any]:
    stamp = dt.datetime.now().strftime("%Y-%m-%d")
    return {
        "schema": SCHEMA_VERSION,
        "kind": kind,
        "id": f"{stamp}-{slug}-{secrets.token_hex(2)}",
        "started": now_iso(),
        "machine": env.machine(),
        "runtime": {"name": env.runtime.name, "version": env.runtime.version()},
        "harness": {"commit": git_commit(env.repo_root),
                    "digest": tree_digest(Path(__file__).resolve().parent)},
        "cases": {"digest": env.cases_digest},
        "prompts": {name: t.digest for name, t in sorted(env.templates.items())},
    }


def _messages(env: Environment, case: Case) -> List[dict]:
    return env.templates[case.task].render(case_values(case))


def generate(env: Environment, config: Config, case: Case, info: Any,
             run_id: str) -> Dict[str, Any]:
    """Run one case and return its result item; raw output goes to the raw folder."""
    settings = config.task(case.task)
    options = dict(settings["options"])
    options["num_ctx"] = context_for(case, int(options.get("num_predict", 2048)), info.context_length)
    think = resolve_think(settings.get("think"), info)
    fmt = REVIEW_SCHEMA if case.task == "review" and settings.get("structured", True) else None
    item: Dict[str, Any] = {"case": case.id, "task": case.task, "split": case.split,
                            "length": case.length, "words": case.words,
                            "numCtx": options["num_ctx"], "think": think}
    with env.sampler() as sampler:
        try:
            gen = env.runtime.chat(config.model, _messages(env, case), options=options,
                                   think=think, fmt=fmt)
        except Exception as err:  # a failed case is recorded, and the run continues
            item["error"] = str(err)[:300]
            env.log(f"  {case.id}: FAILED {item['error']}")
            return item
    # A speculative-decoding drafter loads as a second model, so count every
    # loaded model: run_config unloads all others first, and in a pair run
    # the total is both models together.
    own = env.runtime.loaded()
    item.update({
        "ttftSeconds": _round(gen.ttft_s),
        "firstTokenSeconds": _round(gen.first_token_s),
        "totalSeconds": _round(gen.total_s),
        "loadSeconds": _round(gen.load_s),
        "promptTokens": gen.prompt_tokens,
        "promptTokensPerSecond": _round(gen.prompt_tokens_per_s, 1),
        "outputTokens": gen.output_tokens,
        "tokensPerSecond": _round(gen.tokens_per_s, 1),
        "thinkingWords": len(gen.thinking.split()),
        "doneReason": gen.done_reason,
        "modelGb": _round(sum(m.size_bytes for m in own) / 2**30, 1) if own else None,
        "gpuGb": _round(sum(m.vram_bytes for m in own) / 2**30, 1) if own else None,
        "loadedModels": sorted(m.name for m in own),
        "resources": sampler.summary(),
        "outputDigest": hashlib.sha256(gen.text.encode("utf-8")).hexdigest()[:12],
    })
    item["scores"] = score_review(case, gen.text) if case.task == "review" else score_conversation(case, gen.text)
    raw = env.raw_dir / run_id / f"{case.id}.json"
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_text(json.dumps({"case": case.id, "model": config.model, "text": gen.text,
                               "thinking": gen.thinking}, indent=2) + "\n", encoding="utf-8")
    env.log(f"  {case.id}: ttft {item['ttftSeconds']}s, {item['tokensPerSecond']} tok/s, "
            f"total {item['totalSeconds']}s")
    return item


def run_config(env: Environment, config: Config, cases: List[Case]) -> Path:
    info = env.runtime.info(config.model)
    result = _header(env, "run", config.name)
    result["config"] = {"name": config.name, "model": asdict(info), "hypothesis": config.hypothesis,
                        "conversation": config.task("conversation"), "review": config.task("review")}
    env.log(f"{config.name}: unloading models, then loading {config.model}")
    env.runtime.unload_all()
    first_ctx = min(context_for(c, int(config.task(c.task)["options"].get("num_predict", 2048)),
                                info.context_length) for c in cases)
    result["coldLoadSeconds"] = _round(env.runtime.load(config.model, {"num_ctx": first_ctx}))
    ordered = sorted(cases, key=lambda c: (context_for(c, 2048, info.context_length), c.task, c.id))
    result["items"] = [generate(env, config, case, info, result["id"]) for case in ordered]
    result["finished"] = now_iso()
    return write_result(env.results_dir, result)


def write_result(folder: Path, result: Dict[str, Any]) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{result['id']}.json"
    path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return path


def run_pair(env: Environment, chat: Config, reviewer: Config, chat_cases: List[Case],
             review_case: Case) -> Path:
    """Keep a conversation model and a reviewer loaded together and measure contention."""
    chat_info, review_info = env.runtime.info(chat.model), env.runtime.info(reviewer.model)
    result = _header(env, "pair", f"{chat.name}+{reviewer.name}")
    result["config"] = {"chat": {"name": chat.name, "model": asdict(chat_info)},
                        "reviewer": {"name": reviewer.name, "model": asdict(review_info)}}
    env.runtime.unload_all()
    review_ctx = context_for(review_case, int(reviewer.task("review")["options"].get("num_predict", 2048)),
                             review_info.context_length)
    env.runtime.load(reviewer.model, {"num_ctx": review_ctx})
    env.runtime.load(chat.model, {"num_ctx": min(context_for(c, 2048, chat_info.context_length)
                                                  for c in chat_cases)})
    idle = [generate(env, chat, c, chat_info, result["id"]) for c in chat_cases]
    stop = threading.Event()
    reviews: List[Dict[str, Any]] = []

    def review_loop() -> None:
        while not stop.is_set():
            reviews.append(generate(env, reviewer, review_case, review_info, result["id"]))

    worker = threading.Thread(target=review_loop, daemon=True)
    worker.start()
    time.sleep(5)
    busy = [generate(env, chat, c, chat_info, result["id"]) for c in chat_cases]
    stop.set()
    worker.join()
    loaded = {m.name: m for m in env.runtime.loaded()}
    result["bothLoaded"] = chat.model in loaded and reviewer.model in loaded
    result["loadedGb"] = _round(sum(m.size_bytes for m in loaded.values()) / 2**30, 1)
    result["items"] = [dict(i, phase="idle") for i in idle] + [dict(i, phase="duringReview") for i in busy] \
        + [dict(i, phase="review") for i in reviews]
    result["finished"] = now_iso()
    return write_result(env.results_dir, result)


def run_sustained(env: Environment, config: Config, case: Case, minutes: float) -> Path:
    """Review one case repeatedly for a period, sampling power and thermal state throughout."""
    info = env.runtime.info(config.model)
    result = _header(env, "sustained", config.name)
    result["config"] = {"name": config.name, "model": asdict(info)}
    result["onBattery"] = monitor.on_battery()
    env.runtime.load(config.model)
    deadline = time.monotonic() + minutes * 60
    items = []
    with env.sampler() as sampler:
        while time.monotonic() < deadline:
            items.append(generate(env, config, case, info, result["id"]))
    result["minutes"] = minutes
    result["resources"] = sampler.summary()
    result["items"] = items
    result["finished"] = now_iso()
    return write_result(env.results_dir, result)
