"""Adapters that run a model and report what the writer would feel.

Each runtime exposes the same small surface so the runner never depends on a
particular server. Ollama is the first; the service's HTTP API and cloud
providers are planned adapters.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional

NS = 1_000_000_000
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"


class RuntimeUnavailable(Exception):
    """The runtime cannot be reached or does not have the model."""


class GenerationFailed(Exception):
    """The runtime was reached but the generation failed."""


@dataclass
class Generation:
    text: str
    thinking: str = ""
    ttft_s: Optional[float] = None
    first_token_s: Optional[float] = None
    total_s: float = 0.0
    prompt_tokens: Optional[int] = None
    prompt_s: Optional[float] = None
    output_tokens: Optional[int] = None
    output_s: Optional[float] = None
    load_s: Optional[float] = None
    done_reason: str = ""

    @property
    def tokens_per_s(self) -> Optional[float]:
        if self.output_tokens and self.output_s:
            return self.output_tokens / self.output_s
        return None

    @property
    def prompt_tokens_per_s(self) -> Optional[float]:
        if self.prompt_tokens and self.prompt_s:
            return self.prompt_tokens / self.prompt_s
        return None


@dataclass
class ModelInfo:
    name: str
    digest: str = ""
    family: str = ""
    parameter_size: str = ""
    quantization: str = ""
    format: str = ""
    runner: str = ""
    context_length: Optional[int] = None
    license_head: str = ""
    thinking: List[Any] = field(default_factory=list)
    sampling: str = ""


@dataclass
class LoadedModel:
    name: str
    size_bytes: int
    vram_bytes: int
    context_length: Optional[int] = None


def ollama_url_from_env(env: Optional[Dict[str, str]] = None) -> str:
    """Read Ollama's own OLLAMA_HOST convention, which may omit the scheme."""
    value = (env if env is not None else os.environ).get("OLLAMA_HOST", "").strip()
    if not value:
        return DEFAULT_OLLAMA_URL
    if "://" not in value:
        value = "http://" + value
    host = value.split("://", 1)[1]
    if ":" not in host.split("/", 1)[0]:
        value = value.rstrip("/") + ":11434"
    return value.rstrip("/").replace("://0.0.0.0", "://127.0.0.1")


class OllamaRuntime:
    name = "ollama"

    def __init__(self, base_url: str = DEFAULT_OLLAMA_URL, timeout_s: float = 3600.0,
                 clock: Callable[[], float] = time.monotonic):
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.clock = clock

    def _request(self, method: str, path: str, body: Optional[dict] = None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            self.base_url + path, data=data, method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            return urllib.request.urlopen(req, timeout=self.timeout_s)
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "replace")[:300]
            if err.code == 404:
                raise RuntimeUnavailable(f"ollama at {self.base_url}: {detail}") from None
            raise GenerationFailed(f"ollama {path} returned {err.code}: {detail}") from None
        except (urllib.error.URLError, OSError) as err:
            raise RuntimeUnavailable(f"ollama is not reachable at {self.base_url}: {err}") from None

    def _json(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        with self._request(method, path, body) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def version(self) -> str:
        return str(self._json("GET", "/api/version").get("version", ""))

    def info(self, model: str) -> ModelInfo:
        tags = self._json("GET", "/api/tags").get("models", [])
        digest = next((m.get("digest", "") for m in tags if m.get("name") == model), None)
        if digest is None:
            raise RuntimeUnavailable(f"model '{model}' is not pulled; run: ollama pull {model}")
        shown = self._json("POST", "/api/show", {"model": model})
        details = shown.get("details", {}) or {}
        model_info = shown.get("model_info", {}) or {}
        context = next((v for k, v in model_info.items() if k.endswith(".context_length")), None)
        license_text = shown.get("license", "") or ""
        thinking = (shown.get("thinking") or {}).get("values") or []
        if not thinking and "thinking" in shown.get("capabilities", []):
            thinking = [False, True]
        return ModelInfo(
            name=model,
            digest=digest,
            family=details.get("family", ""),
            parameter_size=details.get("parameter_size", ""),
            quantization=details.get("quantization_level", ""),
            format=details.get("format", ""),
            runner=details.get("runner", ""),
            context_length=context if isinstance(context, int) else None,
            license_head=" ".join(license_text.split())[:160],
            thinking=list(thinking),
            sampling=" ".join((shown.get("parameters") or "").split()),
        )

    def loaded(self) -> List[LoadedModel]:
        models = self._json("GET", "/api/ps").get("models", [])
        return [
            LoadedModel(
                name=m.get("name", ""),
                size_bytes=int(m.get("size", 0)),
                vram_bytes=int(m.get("size_vram", 0)),
                context_length=m.get("context_length"),
            )
            for m in models
        ]

    def unload(self, model: str) -> None:
        self._json("POST", "/api/generate", {"model": model, "keep_alive": 0})
        deadline = self.clock() + 60
        while any(m.name == model for m in self.loaded()) and self.clock() < deadline:
            time.sleep(0.5)

    def unload_all(self) -> None:
        for model in self.loaded():
            self.unload(model.name)

    def load(self, model: str, options: Optional[dict] = None, keep_alive: str = "30m") -> float:
        """Load the model without generating and return the wall-clock seconds taken."""
        start = self.clock()
        body = {"model": model, "keep_alive": keep_alive, "options": options or {}}
        self._json("POST", "/api/generate", body)
        return self.clock() - start

    def chat(self, model: str, messages: List[dict], options: Optional[dict] = None,
             think: Any = None, fmt: Any = None, keep_alive: str = "30m") -> Generation:
        body: Dict[str, Any] = {
            "model": model, "messages": messages, "stream": True,
            "options": options or {}, "keep_alive": keep_alive,
        }
        if think is not None:
            body["think"] = think
        if fmt is not None:
            body["format"] = fmt
        start = self.clock()
        with self._request("POST", "/api/chat", body) as resp:
            return collect_stream(_lines(resp), start, self.clock)


def _lines(resp) -> Iterator[bytes]:
    for line in resp:
        if line.strip():
            yield line


def collect_stream(lines, start: float, clock: Callable[[], float]) -> Generation:
    """Fold Ollama's streamed chat chunks into one Generation with timings."""
    text: List[str] = []
    thinking: List[str] = []
    ttft = first = None
    final: dict = {}
    for raw in lines:
        chunk = json.loads(raw)
        if "error" in chunk:
            raise GenerationFailed(str(chunk["error"])[:300])
        message = chunk.get("message", {}) or {}
        content = message.get("content", "") or ""
        thought = message.get("thinking", "") or ""
        now = clock()
        if (content or thought) and first is None:
            first = now - start
        if content and ttft is None:
            ttft = now - start
        text.append(content)
        thinking.append(thought)
        if chunk.get("done"):
            final = chunk
    if not final:
        raise GenerationFailed("stream ended without a final chunk")
    total = clock() - start

    def seconds(key: str) -> Optional[float]:
        value = final.get(key)
        return value / NS if isinstance(value, (int, float)) else None

    return Generation(
        text="".join(text),
        thinking="".join(thinking),
        ttft_s=ttft,
        first_token_s=first,
        total_s=total,
        prompt_tokens=final.get("prompt_eval_count"),
        prompt_s=seconds("prompt_eval_duration"),
        output_tokens=final.get("eval_count"),
        output_s=seconds("eval_duration"),
        load_s=seconds("load_duration"),
        done_reason=final.get("done_reason", ""),
    )


@dataclass
class FakeRuntime:
    """A deterministic runtime for tests: replies come from a function of the request."""

    reply: Callable[[str, List[dict]], str]
    version_value: str = "fake-1"
    calls: List[dict] = field(default_factory=list)
    name: str = "fake"
    _loaded: Dict[str, int] = field(default_factory=dict)

    def version(self) -> str:
        return self.version_value

    def info(self, model: str) -> ModelInfo:
        if model.startswith("missing"):
            raise RuntimeUnavailable(f"model '{model}' is not pulled")
        return ModelInfo(name=model, digest="0" * 64, family="fake", parameter_size="1B",
                         quantization="Q4_K_M", format="gguf", thinking=[False, "low", "high"])

    def loaded(self) -> List[LoadedModel]:
        return [LoadedModel(name, size, size) for name, size in self._loaded.items()]

    def unload(self, model: str) -> None:
        self._loaded.pop(model, None)

    def unload_all(self) -> None:
        self._loaded.clear()

    def load(self, model: str, options: Optional[dict] = None, keep_alive: str = "30m") -> float:
        self._loaded[model] = 1_000_000
        return 0.5

    def chat(self, model: str, messages: List[dict], options: Optional[dict] = None,
             think: Any = None, fmt: Any = None, keep_alive: str = "30m") -> Generation:
        self.calls.append({"model": model, "messages": messages, "options": options,
                           "think": think, "format": fmt})
        self._loaded[model] = 1_000_000
        text = self.reply(model, messages)
        words = len(text.split())
        return Generation(text=text, ttft_s=0.1, first_token_s=0.1, total_s=1.0,
                          prompt_tokens=100, prompt_s=0.2, output_tokens=words,
                          output_s=0.5, load_s=0.0, done_reason="stop")
