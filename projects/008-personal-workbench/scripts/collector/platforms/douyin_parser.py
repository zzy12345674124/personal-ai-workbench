"""抖音响应到公共数据字段的纯函数转换；不得包含浏览器操作。"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from ..core import CollectorError, utc_now


VIDEO_PATH_RE = re.compile(r"^/video/(\d+)$")


def number(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    return int(value) if isinstance(value, (int, float)) else default


def timestamp(value: Any) -> str | None:
    raw = number(value, -1)
    if raw < 0:
        return None
    try:
        return datetime.fromtimestamp(raw, timezone.utc).isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return None


def safe_content_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    parts = urlsplit(value)
    host = (parts.hostname or "").lower()
    match = VIDEO_PATH_RE.fullmatch(parts.path)
    if host not in {"douyin.com", "www.douyin.com"} or match is None:
        return None
    return f"https://www.douyin.com/video/{match.group(1)}"


def normalize_content(info: Any, *, fetched_at: str | None = None) -> dict[str, Any] | None:
    if not isinstance(info, dict):
        return None
    content_id = info.get("aweme_id")
    if not isinstance(content_id, str) or not content_id.isdigit():
        return None
    status = info.get("status") if isinstance(info.get("status"), dict) else {}
    if status.get("is_delete") is True or status.get("is_private") is True:
        return None
    author = info.get("author") if isinstance(info.get("author"), dict) else {}
    statistics = info.get("statistics") if isinstance(info.get("statistics"), dict) else {}
    return {
        "content_id": content_id,
        "content_url": f"https://www.douyin.com/video/{content_id}",
        "title": info.get("desc") if isinstance(info.get("desc"), str) else "",
        "author_display_name": author.get("nickname") if isinstance(author.get("nickname"), str) else None,
        "published_at": timestamp(info.get("create_time")),
        "fetched_at": fetched_at or utc_now(),
        "like_count": number(statistics.get("digg_count")),
        "comment_count": number(statistics.get("comment_count")),
        "platform_extra": {
            "aweme_type": number(info.get("aweme_type")),
            "play_count": number(statistics.get("play_count")),
            "share_count": number(statistics.get("share_count")),
        },
    }


def contents_from_search_payload(payload: Any) -> tuple[list[dict[str, Any]], int | None, bool]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise CollectorError("PAGE_CHANGED", "抖音搜索响应缺少 data")
    fetched_at = utc_now()
    contents: list[dict[str, Any]] = []
    for entry in payload["data"]:
        info = entry.get("aweme_info") if isinstance(entry, dict) else None
        normalized = normalize_content(info, fetched_at=fetched_at)
        if normalized is not None:
            contents.append(normalized)
    cursor = payload.get("cursor") if isinstance(payload.get("cursor"), int) else None
    return contents, cursor, bool(number(payload.get("has_more")))


def normalize_comment(
    raw: Any, *, content_id: str, parent_comment_id: str | None = None, fetched_at: str | None = None,
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    comment_id = raw.get("cid")
    text = raw.get("text")
    if not isinstance(comment_id, str) or not comment_id or not isinstance(text, str):
        return None
    user = raw.get("user") if isinstance(raw.get("user"), dict) else {}
    reply_id = raw.get("reply_id")
    detected_parent = reply_id if isinstance(reply_id, str) and reply_id not in {"", "0"} else None
    return {
        "content_id": content_id,
        "comment_id": comment_id,
        "parent_comment_id": parent_comment_id or detected_parent,
        "author_display_name": user.get("nickname") if isinstance(user.get("nickname"), str) else None,
        "text": text,
        "like_count": number(raw.get("digg_count")),
        "published_at": timestamp(raw.get("create_time")),
        "fetched_at": fetched_at or utc_now(),
        "ip_location": raw.get("ip_label") if isinstance(raw.get("ip_label"), str) else None,
        "platform_extra": {
            "reply_comment_total": number(raw.get("reply_comment_total")),
            "is_hot": raw.get("is_hot") is True,
            "level": number(raw.get("level")),
        },
    }


def comments_from_payload(payload: Any, *, content_id: str) -> tuple[list[dict[str, Any]], int | None, bool]:
    if not isinstance(payload, dict) or not isinstance(payload.get("comments"), list):
        raise CollectorError("PAGE_CHANGED", "抖音评论响应缺少 comments")
    fetched_at = utc_now()
    comments: list[dict[str, Any]] = []
    for raw in payload["comments"]:
        normalized = normalize_comment(raw, content_id=content_id, fetched_at=fetched_at)
        if normalized is not None:
            comments.append(normalized)
        replies = raw.get("reply_comment") if isinstance(raw, dict) else None
        if isinstance(replies, list) and normalized is not None:
            for reply in replies:
                child = normalize_comment(
                    reply, content_id=content_id, parent_comment_id=normalized["comment_id"], fetched_at=fetched_at,
                )
                if child is not None:
                    comments.append(child)
    cursor = payload.get("cursor") if isinstance(payload.get("cursor"), int) else None
    return comments, cursor, bool(number(payload.get("has_more")))
