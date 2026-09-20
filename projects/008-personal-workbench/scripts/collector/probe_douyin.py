"""抖音可见窗口最小探测。

只记录页面正常收到的接口路径、查询参数名和 JSON 字段形状；
不保存请求头、Cookie、查询参数值、正文、昵称或评论内容。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit


DOUYIN_HOST_SUFFIXES = ("douyin.com", "douyinvod.com")
INTERESTING_PATH_PARTS = ("/aweme/", "/search/", "/comment/", "/user/profile/")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sanitized_endpoint(url: str) -> dict[str, Any] | None:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if not any(host == suffix or host.endswith(f".{suffix}") for suffix in DOUYIN_HOST_SUFFIXES):
        return None
    if not any(part in parts.path for part in INTERESTING_PATH_PARTS):
        return None
    return {
        "host": host,
        "path": parts.path,
        "queryKeys": sorted({key for key, _ in parse_qsl(parts.query, keep_blank_values=True)}),
    }


def schema_signature(value: Any, depth: int = 0, max_depth: int = 5) -> Any:
    if depth >= max_depth:
        return type(value).__name__
    if isinstance(value, dict):
        return {key: schema_signature(value[key], depth + 1, max_depth) for key in sorted(value)}
    if isinstance(value, list):
        return [] if not value else [schema_signature(value[0], depth + 1, max_depth)]
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    return type(value).__name__


def safe_video_url(href: str | None) -> str | None:
    if not href:
        return None
    candidate = f"https:{href}" if href.startswith("//") else href
    parts = urlsplit(candidate if candidate.startswith("http") else f"https://www.douyin.com{candidate}")
    host = (parts.hostname or "").lower()
    if host not in {"douyin.com", "www.douyin.com"} or not re.fullmatch(r"/video/\d+", parts.path):
        return None
    return f"https://www.douyin.com{parts.path}"


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    temp = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def safe_page_state(page: Any) -> dict[str, Any]:
    """读取页面状态但不把页面正文或控件文字写入磁盘。"""
    try:
        text = page.locator("body").inner_text(timeout=3_000)
    except Exception:
        text = ""
    parts = urlsplit(page.url)
    return {
        "at": utc_now(),
        "host": (parts.hostname or "").lower(),
        "path": "/video/{id}" if re.fullmatch(r"/video/\d+", parts.path) else parts.path,
        "queryKeys": sorted({key for key, _ in parse_qsl(parts.query, keep_blank_values=True)}),
        "readyState": page.evaluate("document.readyState"),
        "bodyTextLength": len(text),
        "hasLoginMarker": any(marker in text for marker in ("登录", "扫码登录", "手机号登录")),
        "hasHumanCheckMarker": any(marker in text for marker in ("验证码", "安全验证", "滑块验证")),
        "hasErrorMarker": any(marker in text for marker in ("网络错误", "页面加载失败", "访问频繁")),
        "searchInputCount": page.locator('input[placeholder*="搜索"]').count(),
        "videoElementCount": page.locator("video").count(),
        "storesContent": False,
    }


def run_probe(
    url: str, timeout_seconds: int, output_dir: Path, profile_dir: Path,
    open_first_video: bool = False, scroll_count: int = 0,
) -> int:
    if os.name == "nt" and not os.environ.get("PROCESSOR_ARCHITECTURE"):
        os.environ["PROCESSOR_ARCHITECTURE"] = "AMD64" if sys.maxsize > 2**32 else "x86"
    from cloakbrowser import launch_persistent_context

    output_dir.mkdir(parents=True, exist_ok=True)
    profile_dir.mkdir(parents=True, exist_ok=True)
    events_path = output_dir / "schema-events.jsonl"
    status_path = output_dir / "status.json"
    seen: set[str] = set()
    event_count = 0
    started = time.monotonic()
    atomic_json(status_path, {
        "state": "starting", "startedAt": utc_now(), "eventCount": 0,
        "profileDir": str(profile_dir), "storesContent": False,
    })

    def on_response(response: Any) -> None:
        nonlocal event_count
        if event_count >= 100:
            return
        endpoint = sanitized_endpoint(response.url)
        if endpoint is None:
            return
        content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        signature: Any = None
        if content_type == "application/json":
            try:
                signature = schema_signature(response.json())
            except Exception:
                signature = {"unreadable": True}
        digest = hashlib.sha256(
            json.dumps({"endpoint": endpoint, "schema": signature}, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()[:16]
        if digest in seen:
            return
        seen.add(digest)
        event = {
            "at": utc_now(), "status": response.status, "contentType": content_type,
            "endpoint": endpoint, "schema": signature, "signatureId": digest,
        }
        with events_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
        event_count += 1
        atomic_json(status_path, {
            "state": "observing", "updatedAt": utc_now(), "eventCount": event_count,
            "profileDir": str(profile_dir), "storesContent": False,
        })

    try:
        with launch_persistent_context(str(profile_dir), headless=False) as context:
            page = context.pages[0] if context.pages else context.new_page()
            page.on("response", on_response)
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            if open_first_video:
                page.wait_for_timeout(8_000)
                link = page.locator('a[href*="/video/"]').first
                link.wait_for(state="attached", timeout=30_000)
                video_url = safe_video_url(link.get_attribute("href"))
                if video_url is None:
                    raise RuntimeError("FIRST_VIDEO_URL_INVALID")
                page.goto(video_url, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_timeout(8_000)
                for _ in range(scroll_count):
                    page.mouse.wheel(0, 800)
                    page.wait_for_timeout(3_000)
            print(f"PROBE_READY output={output_dir}", flush=True)
            last_page_state = 0.0
            while time.monotonic() - started < timeout_seconds:
                if not context.pages:
                    break
                if time.monotonic() - last_page_state >= 5:
                    atomic_json(output_dir / "page-state.json", safe_page_state(page))
                    last_page_state = time.monotonic()
                time.sleep(1)
        atomic_json(status_path, {
            "state": "completed", "finishedAt": utc_now(), "eventCount": event_count,
            "profileDir": str(profile_dir), "storesContent": False,
        })
        return 0
    except KeyboardInterrupt:
        atomic_json(status_path, {
            "state": "stopped", "finishedAt": utc_now(), "eventCount": event_count,
            "profileDir": str(profile_dir), "storesContent": False,
        })
        return 0
    except Exception as error:
        atomic_json(status_path, {
            "state": "failed", "finishedAt": utc_now(), "eventCount": event_count,
            "code": type(error).__name__, "profileDir": str(profile_dir), "storesContent": False,
        })
        print(f"PROBE_FAILED {type(error).__name__}: {error}", flush=True)
        return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://www.douyin.com/")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--profile-dir", default=str(Path.home() / ".cloakbrowser" / "profiles" / "douyin"))
    parser.add_argument("--open-first-video", action="store_true")
    parser.add_argument("--scroll-count", type=int, default=0)
    args = parser.parse_args(argv)
    if not 60 <= args.timeout_seconds <= 900:
        parser.error("timeout-seconds 必须在 60–900 之间")
    if not 0 <= args.scroll_count <= 2:
        parser.error("scroll-count 必须在 0–2 之间")
    return run_probe(
        args.url, args.timeout_seconds, Path(args.output_dir).resolve(), Path(args.profile_dir).resolve(),
        open_first_video=args.open_first_video, scroll_count=args.scroll_count,
    )


if __name__ == "__main__":
    raise SystemExit(main())
