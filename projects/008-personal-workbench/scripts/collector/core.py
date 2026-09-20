"""与平台页面无关的任务校验、状态和落盘能力。"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SUPPORTED_PLATFORMS = {"douyin", "xiaohongshu", "bilibili"}
JOB_ID_RE = re.compile(r"^collector-(douyin|xiaohongshu|bilibili)-[a-zA-Z0-9-]{6,80}$")
TERMINAL_STATES = {"completed", "partial", "failed", "stopped"}
ALLOWED_TRANSITIONS = {
    "queued": {"starting", "stopped", "failed"},
    "starting": {"checking_login", "failed", "stopped"},
    "checking_login": {"waiting_login", "waiting_human_check", "searching", "paused", "failed", "stopped"},
    "waiting_login": {"checking_login", "waiting_human_check", "searching", "collecting_comments", "stopped", "failed"},
    "waiting_human_check": {"checking_login", "waiting_login", "searching", "collecting_comments", "stopped", "failed"},
    "searching": {"waiting_login", "waiting_human_check", "collecting_comments", "cooling_down", "paused", "completed", "partial", "failed", "stopped"},
    "collecting_comments": {"waiting_login", "waiting_human_check", "searching", "cooling_down", "paused", "completed", "partial", "failed", "stopped"},
    "cooling_down": {"waiting_login", "waiting_human_check", "searching", "collecting_comments", "paused", "partial", "failed", "stopped"},
    "paused": {"checking_login", "searching", "collecting_comments", "cooling_down", "stopped", "failed"},
}


class CollectorError(ValueError):
    """带稳定错误码的采集合同错误。"""

    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code


def _bounded_int(value: Any, default: int, minimum: int, maximum: int, code: str) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise CollectorError(code)
    return value


def validate_job(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise CollectorError("BAD_JOB")
    platform = raw.get("platform")
    if platform not in SUPPORTED_PLATFORMS:
        raise CollectorError("BAD_PLATFORM")

    raw_keywords = raw.get("keywords")
    if not isinstance(raw_keywords, list) or not 1 <= len(raw_keywords) <= 20:
        raise CollectorError("BAD_KEYWORDS")
    keywords: list[str] = []
    for value in raw_keywords:
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= 50:
            raise CollectorError("BAD_KEYWORDS")
        keyword = value.strip()
        if keyword not in keywords:
            keywords.append(keyword)

    limits = raw.get("limits") if isinstance(raw.get("limits"), dict) else {}
    timing = raw.get("timing") if isinstance(raw.get("timing"), dict) else {}
    browser = raw.get("browser") if isinstance(raw.get("browser"), dict) else {}
    visible = browser.get("visible", True)
    if visible is not True:
        raise CollectorError("BACKGROUND_NOT_APPROVED")

    min_delay = _bounded_int(timing.get("minActionDelayMs"), 1500, 500, 60_000, "BAD_TIMING")
    max_delay = _bounded_int(timing.get("maxActionDelayMs"), 4000, 500, 120_000, "BAD_TIMING")
    if max_delay < min_delay:
        raise CollectorError("BAD_TIMING")

    content_filter = raw.get("contentFilter", "")
    if not isinstance(content_filter, str) or len(content_filter) > 100:
        raise CollectorError("BAD_CONTENT_FILTER")

    return {
        "platform": platform,
        "keywords": keywords,
        "limits": {
            "maxContentsPerKeyword": _bounded_int(limits.get("maxContentsPerKeyword"), 20, 1, 100, "BAD_LIMITS"),
            "maxCommentsPerContent": _bounded_int(limits.get("maxCommentsPerContent"), 100, 1, 1000, "BAD_LIMITS"),
            "maxPagesPerContent": _bounded_int(limits.get("maxPagesPerContent"), 10, 1, 100, "BAD_LIMITS"),
            "maxRuntimeMinutes": _bounded_int(limits.get("maxRuntimeMinutes"), 60, 1, 480, "BAD_LIMITS"),
        },
        "timing": {
            "minActionDelayMs": min_delay,
            "maxActionDelayMs": max_delay,
            "cooldownAfterRateLimitMs": _bounded_int(
                timing.get("cooldownAfterRateLimitMs"), 300_000, 30_000, 3_600_000, "BAD_TIMING"
            ),
        },
        "browser": {"visible": True},
        "contentFilter": content_filter.strip(),
    }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class CollectorStorage:
    """单个任务目录的原子 JSON 和追加式 JSONL 存储。"""

    def __init__(self, job_dir: str | Path):
        self.job_dir = Path(job_dir).resolve()
        self.job_dir.mkdir(parents=True, exist_ok=True)
        self.status_path = self.job_dir / "status.json"
        self.events_path = self.job_dir / "events.jsonl"

    def write_json(self, filename: str, payload: dict[str, Any]) -> Path:
        if not re.fullmatch(r"[a-z][a-z0-9-]*\.json", filename):
            raise CollectorError("BAD_OUTPUT_NAME")
        target = self.job_dir / filename
        fd, temp_name = tempfile.mkstemp(prefix=f".{filename}.", suffix=".tmp", dir=self.job_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, target)
        except Exception:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
            raise
        return target

    def append_jsonl(self, filename: str, payload: dict[str, Any]) -> Path:
        if filename not in {"events.jsonl", "contents.jsonl", "comments.jsonl"}:
            raise CollectorError("BAD_OUTPUT_NAME")
        target = self.job_dir / filename
        with target.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        return target

    def read_status(self) -> dict[str, Any]:
        if not self.status_path.exists():
            return {}
        return json.loads(self.status_path.read_text(encoding="utf-8"))

    def set_state(self, state: str, **extra: Any) -> dict[str, Any]:
        current = self.read_status()
        previous = current.get("state")
        if previous in TERMINAL_STATES:
            raise CollectorError("TERMINAL_STATE")
        if previous is not None and state not in ALLOWED_TRANSITIONS.get(previous, set()):
            raise CollectorError("BAD_STATE_TRANSITION", f"{previous} -> {state}")
        status = {**current, **extra, "state": state, "updatedAt": utc_now()}
        self.write_json("status.json", status)
        self.append_jsonl("events.jsonl", {"at": status["updatedAt"], "state": state, "code": extra.get("code")})
        return status
