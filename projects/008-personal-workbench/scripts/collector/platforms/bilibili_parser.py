"""B站页面响应解析：只接收公开搜索与评论响应，输出公共字段。"""

from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from ..core import CollectorError, utc_now


_BVID_RE = re.compile(r"^BV[0-9A-Za-z]{10}$")


def _text(value: Any, limit: int = 2_000) -> str:
    if value is None:
        return ""
    cleaned = re.sub(r"<[^>]*>", "", html.unescape(str(value))).strip()
    return cleaned[:limit]


def _count(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _time(value: Any) -> str | None:
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat(timespec="seconds")
    return None


def safe_content_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    parts = urlsplit(value)
    if parts.scheme != "https" or parts.hostname not in {"bilibili.com", "www.bilibili.com"}:
        return None
    match = re.fullmatch(r"/video/(BV[0-9A-Za-z]{10})/?", parts.path)
    return f"https://www.bilibili.com/video/{match.group(1)}" if match else None


def content_from_dom(*, href: Any, title: Any, author: Any) -> dict[str, Any] | None:
    """把搜索页公开卡片映射到公共内容合同；不依赖易变 class 名之外的字段。"""
    if not isinstance(href, str):
        return None
    candidate = f"https:{href}" if href.startswith("//") else href
    if candidate.startswith("/video/"):
        candidate = f"https://www.bilibili.com{candidate}"
    content_url = safe_content_url(candidate)
    if content_url is None:
        return None
    content_id = content_url.rsplit("/", 1)[-1]
    return {
        "content_id": content_id,
        "content_url": content_url,
        "title": _text(title, 500),
        "author_display_name": _text(author, 500),
        "published_at": None,
        "fetched_at": utc_now(),
        "like_count": 0,
        "comment_count": 0,
    }


def contents_from_search_payload(payload: Any) -> tuple[list[dict[str, Any]], int, bool]:
    data = payload.get("data") if isinstance(payload, dict) else None
    rows = data.get("result") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise CollectorError("PAGE_CHANGED")
    fetched_at = utc_now()
    items: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        bvid = str(row.get("bvid") or "")
        if not _BVID_RE.fullmatch(bvid):
            continue
        items.append({
            "content_id": bvid,
            "content_url": f"https://www.bilibili.com/video/{bvid}",
            "title": _text(row.get("title"), 500),
            "author_display_name": _text(row.get("author"), 500),
            "published_at": _time(row.get("pubdate")),
            "fetched_at": fetched_at,
            "like_count": 0,
            "comment_count": _count(row.get("review")),
        })
    page = _count(data.get("page")) or 1
    pages = _count(data.get("numPages")) or page
    return items, page, page < pages


def _comment(row: dict[str, Any], *, content_id: str, parent_id: str | None, fetched_at: str) -> dict[str, Any] | None:
    comment_id = str(row.get("rpid") or "")
    content = row.get("content") if isinstance(row.get("content"), dict) else {}
    member = row.get("member") if isinstance(row.get("member"), dict) else {}
    text = _text(content.get("message"))
    if not comment_id or not text:
        return None
    control = row.get("reply_control") if isinstance(row.get("reply_control"), dict) else {}
    location = _text(control.get("location"), 100).removeprefix("IP属地：")
    return {
        "content_id": content_id,
        "comment_id": comment_id,
        "parent_comment_id": parent_id,
        "author_display_name": _text(member.get("uname"), 500),
        "text": text,
        "like_count": _count(row.get("like")),
        "published_at": _time(row.get("ctime")),
        "fetched_at": fetched_at,
        "ip_location": location,
    }


def comments_from_payload(payload: Any, *, content_id: str) -> tuple[list[dict[str, Any]], str, bool]:
    data = payload.get("data") if isinstance(payload, dict) else None
    rows = data.get("replies") if isinstance(data, dict) else None
    if rows is None:
        rows = []
    if not isinstance(rows, list):
        raise CollectorError("PAGE_CHANGED")
    fetched_at = utc_now()
    items: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        root = _comment(row, content_id=content_id, parent_id=None, fetched_at=fetched_at)
        if root:
            items.append(root)
        root_id = str(row.get("rpid") or "") or None
        replies = row.get("replies") if isinstance(row.get("replies"), list) else []
        for reply in replies:
            if isinstance(reply, dict):
                child = _comment(reply, content_id=content_id, parent_id=root_id, fetched_at=fetched_at)
                if child:
                    items.append(child)
    cursor = data.get("cursor") if isinstance(data, dict) and isinstance(data.get("cursor"), dict) else {}
    pagination_reply = cursor.get("pagination_reply")
    if not isinstance(pagination_reply, dict):
        pagination_reply = {}
    cursor_value = str(cursor.get("next") or pagination_reply.get("next_offset") or "")
    has_more = cursor.get("is_end") is False or bool(cursor_value)
    return items, cursor_value, has_more
