"""Machine facts and resource sampling that need no elevated privileges.

On macOS, system power comes from the battery controller's SystemPowerIn
reading, thermal state from `pmset -g therm`, and memory from `vm_stat`. On
other systems the readings are None, so tests and the development container
still run.
"""

from __future__ import annotations

import platform
import re
import subprocess
import threading
import time
from typing import Callable, Dict, List, Optional


def _run(args: List[str]) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=10, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def machine() -> Dict[str, object]:
    if platform.system() != "Darwin":
        return {"chip": platform.machine(), "memoryGb": None, "os": platform.platform()}
    chip = _run(["sysctl", "-n", "machdep.cpu.brand_string"]).strip()
    memory = _run(["sysctl", "-n", "hw.memsize"]).strip()
    model = _run(["sysctl", "-n", "hw.model"]).strip()
    os_version = _run(["sw_vers", "-productVersion"]).strip()
    return {
        "chip": chip,
        "model": model,
        "memoryGb": round(int(memory) / 2**30) if memory.isdigit() else None,
        "os": f"macOS {os_version}",
    }


def power_watts() -> Optional[float]:
    out = _run(["ioreg", "-rn", "AppleSmartBattery"])
    match = re.search(r'"SystemPowerIn"=(\d+)', out)
    return int(match.group(1)) / 1000 if match else None


def on_battery() -> Optional[bool]:
    out = _run(["pmset", "-g", "batt"])
    if not out:
        return None
    return "Battery Power" in out


def thermal() -> Dict[str, Optional[int]]:
    out = _run(["pmset", "-g", "therm"])
    speed = re.search(r"CPU_Speed_Limit\s*=\s*(\d+)", out)
    level = re.search(r"thermal warning level\D*(\d+)", out, re.I)
    return {"speedLimit": int(speed.group(1)) if speed else None,
            "warningLevel": int(level.group(1)) if level else None}


def memory_used_bytes() -> Optional[int]:
    out = _run(["vm_stat"])
    size = re.search(r"page size of (\d+) bytes", out)
    if not size:
        return None
    page = int(size.group(1))

    def pages(label: str) -> int:
        match = re.search(rf"{label}:\s+(\d+)", out)
        return int(match.group(1)) if match else 0

    used = pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")
    return used * page


def runner_bytes() -> Optional[int]:
    """Resident memory of the processes `ollama serve` starts to run models.

    Ollama's own /api/ps undercounts memory-mapped weights, so this reads the
    runners' resident set from `ps` instead.
    """
    out = _run(["ps", "-axo", "pid=,ppid=,rss=,command="])
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4 and parts[0].isdigit() and parts[1].isdigit() and parts[2].isdigit():
            rows.append((int(parts[0]), int(parts[1]), int(parts[2]), parts[3]))
    servers = {pid for pid, _, _, cmd in rows if cmd.rstrip().endswith("ollama serve")}
    if not servers:
        return None
    return sum(rss for _, ppid, rss, _ in rows if ppid in servers) * 1024


class Sampler:
    """Samples power, thermal state, and memory on a background thread."""

    def __init__(self, interval_s: float = 2.0, reader: Optional[Callable[[], Dict]] = None):
        self.interval_s = interval_s
        self.reader = reader or self._read
        self.samples: List[Dict] = []
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    @staticmethod
    def _read() -> Dict:
        sample = {"t": time.monotonic(), "watts": power_watts(), "memoryUsed": memory_used_bytes(),
                  "runner": runner_bytes()}
        sample.update(thermal())
        return sample

    def __enter__(self) -> "Sampler":
        self.samples.append(self.reader())
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self

    def _loop(self) -> None:
        while not self._stop.wait(self.interval_s):
            self.samples.append(self.reader())

    def __exit__(self, *exc) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join()
        self.samples.append(self.reader())

    def summary(self) -> Dict[str, Optional[float]]:
        watts = [s["watts"] for s in self.samples if s.get("watts") is not None]
        memory = [s["memoryUsed"] for s in self.samples if s.get("memoryUsed") is not None]
        speeds = [s["speedLimit"] for s in self.samples if s.get("speedLimit") is not None]
        levels = [s["warningLevel"] for s in self.samples if s.get("warningLevel") is not None]
        runner = [s["runner"] for s in self.samples if s.get("runner") is not None]
        return {
            "meanWatts": round(sum(watts) / len(watts), 1) if watts else None,
            "maxWatts": round(max(watts), 1) if watts else None,
            "maxMemoryUsedGb": round(max(memory) / 2**30, 1) if memory else None,
            "maxRunnerGb": round(max(runner) / 2**30, 1) if runner else None,
            "minCpuSpeedLimit": min(speeds) if speeds else None,
            "maxThermalWarning": max(levels) if levels else None,
        }
