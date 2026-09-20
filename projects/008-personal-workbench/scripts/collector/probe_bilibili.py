"""B站可见窗口脱敏探测：只保存接口路径、查询键名、状态与 JSON 字段形状。"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, quote, urlsplit

from .probe_douyin import schema_signature


def sanitized_endpoint(url: str) -> dict[str, Any] | None:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if host != "bilibili.com" and not host.endswith(".bilibili.com"):
        return None
    path = parts.path.lower()
    if not any(marker in path for marker in ("search", "reply", "comment")):
        return None
    return {
        "host": host,
        "path": parts.path,
        "queryKeys": sorted({key for key, _ in parse_qsl(parts.query, keep_blank_values=True)}),
    }


def run_probe(output: Path, profile: Path, keyword: str, seconds: int, open_first_video: bool = False) -> int:
    if os.name == "nt" and not os.environ.get("PROCESSOR_ARCHITECTURE"):
        os.environ["PROCESSOR_ARCHITECTURE"] = "AMD64" if sys.maxsize > 2**32 else "x86"
    from cloakbrowser import launch_persistent_context

    output.parent.mkdir(parents=True, exist_ok=True)
    profile.mkdir(parents=True, exist_ok=True)
    events: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()

    def on_response(response: Any) -> None:
        endpoint = sanitized_endpoint(response.url)
        if endpoint is None or len(events) >= 50:
            return
        key = (endpoint["path"], response.status)
        if key in seen:
            return
        seen.add(key)
        content_type = (response.headers.get("content-type") or "").split(";", 1)[0].lower()
        schema: Any = None
        if content_type == "application/json":
            try:
                schema = schema_signature(response.json())
            except Exception:
                schema = {"unreadable": True}
        events.append({
            "status": response.status,
            "contentType": content_type,
            "endpoint": endpoint,
            "schema": schema,
            "storesContent": False,
        })

    page_state: dict[str, Any] = {}
    with launch_persistent_context(str(profile), headless=False) as context:
        page = context.pages[0] if context.pages else context.new_page()
        page.on("response", on_response)
        page.goto(
            f"https://search.bilibili.com/video?keyword={quote(keyword, safe='')}",
            wait_until="domcontentloaded", timeout=60_000,
        )
        elapsed = 0
        while elapsed < seconds:
            page.wait_for_timeout(2_000)
            elapsed += 2
            if elapsed % 6 == 0:
                page.mouse.wheel(0, 900)
        try:
            body = page.locator("body").inner_text(timeout=3_000)
        except Exception:
            body = ""
        links = page.locator('a[href*="/video/BV"]')
        samples = []
        for index in range(min(5, links.count())):
            link = links.nth(index)
            href = link.get_attribute("href") or ""
            parts = urlsplit(f"https:{href}" if href.startswith("//") else href)
            path = parts.path if parts.hostname and parts.hostname.endswith("bilibili.com") else ""
            samples.append({
                "tag": link.evaluate("el => el.tagName"),
                "classNames": sorted((link.get_attribute("class") or "").split()),
                "path": path if path.startswith("/video/BV") else "",
            })
        page_state = {
            "videoLinkCount": links.count(),
            "videoCardCount": page.locator(".bili-video-card").count(),
            "titledHeadingCount": page.locator(".bili-video-card h3[title]").count(),
            "authorNodeCount": page.locator(".bili-video-card__info--author").count(),
            "samples": samples,
            "hasHumanCheckMarker": any(marker in body for marker in ("安全验证", "请完成验证", "滑动验证")),
            "hasRateLimitMarker": any(marker in body for marker in ("请求过于频繁", "访问频繁", "稍后再试")),
            "bodyTextLength": len(body),
            "storesContent": False,
        }
        if open_first_video:
            first_path = next((sample["path"] for sample in samples if sample["path"]), "")
            if first_path:
                page.goto(f"https://www.bilibili.com{first_path}", wait_until="domcontentloaded", timeout=60_000)
                for _ in range(10):
                    page.wait_for_timeout(1_500)
                    page.mouse.wheel(0, 1_200)
                page_state["openedVideo"] = True
                page_state["videoPageCommentNodeCount"] = page.locator(
                    '.reply-item, .root-reply-container, bili-comments, bili-comment-thread-renderer'
                ).count()
            else:
                page_state["openedVideo"] = False
    temp = output.with_suffix(f"{output.suffix}.{os.getpid()}.tmp")
    temp.write_text(json.dumps({"events": events, "pageState": page_state, "storesContent": False}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, output)
    print(f"BILIBILI_PROBE events={len(events)} output={output}", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--profile", default=str(Path.home() / ".cloakbrowser" / "profiles" / "bilibili"))
    parser.add_argument("--keyword", default="人工智能")
    parser.add_argument("--seconds", type=int, default=24)
    parser.add_argument("--open-first-video", action="store_true")
    args = parser.parse_args(argv)
    if not 10 <= args.seconds <= 60:
        parser.error("seconds 必须在 10–60 之间")
    return run_probe(
        Path(args.output).resolve(), Path(args.profile).resolve(), args.keyword,
        args.seconds, open_first_video=args.open_first_video,
    )


if __name__ == "__main__":
    raise SystemExit(main())
