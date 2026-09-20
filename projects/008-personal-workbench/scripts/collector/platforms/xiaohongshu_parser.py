"""小红书响应到公共字段的纯函数转换；平台令牌只用于内存导航，不进入公共记录。"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode, urlsplit

from ..core import CollectorError, utc_now


NOTE_PATH_RE = re.compile(r"^/(?:explore|discovery/item)/([A-Za-z0-9_-]{6,80})$")


def number(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return default


def timestamp(value: Any) -> str | None:
    raw = number(value, -1)
    if raw < 0:
        return None
    if raw >= 1_000_000_000_000:
        raw /= 1000
    try:
        return datetime.fromtimestamp(raw, timezone.utc).isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return None


def safe_content_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    parts = urlsplit(value)
    host = (parts.hostname or "").lower()
    match = NOTE_PATH_RE.fullmatch(parts.path)
    if host not in {"xiaohongshu.com", "www.xiaohongshu.com"} or match is None:
        return None
    return f"https://www.xiaohongshu.com/explore/{match.group(1)}"


def _normalize_content(entry: Any, *, fetched_at: str) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    card = entry.get("note_card") if isinstance(entry.get("note_card"), dict) else {}
    content_id = entry.get("id") or card.get("note_id") or card.get("id")
    if not isinstance(content_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{6,80}", content_id):
        return None
    user = card.get("user") if isinstance(card.get("user"), dict) else {}
    interact = card.get("interact_info") if isinstance(card.get("interact_info"), dict) else {}
    title = card.get("display_title") or card.get("title") or card.get("desc") or ""
    return {
        "content_id": content_id,
        "content_url": f"https://www.xiaohongshu.com/explore/{content_id}",
        "title": title if isinstance(title, str) else "",
        "author_display_name": user.get("nickname") if isinstance(user.get("nickname"), str) else None,
        "published_at": timestamp(card.get("time") or card.get("create_time")),
        "fetched_at": fetched_at,
        "like_count": number(interact.get("liked_count") or interact.get("like_count")),
        "comment_count": number(interact.get("comment_count")),
        "platform_extra": {
            "note_type": card.get("type") if isinstance(card.get("type"), str) else None,
        },
    }


def search_entries_from_payload(payload: Any) -> tuple[list[dict[str, Any]], str | None, bool]:
    data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else None
    if data is None or not isinstance(data.get("items"), list):
        raise CollectorError("PAGE_CHANGED", "小红书搜索响应缺少 data.items")
    fetched_at = utc_now()
    entries: list[dict[str, Any]] = []
    for raw in data["items"]:
        record = _normalize_content(raw, fetched_at=fetched_at)
        if record is None:
            continue
        card = raw.get("note_card") if isinstance(raw, dict) and isinstance(raw.get("note_card"), dict) else {}
        token = raw.get("xsec_token") or card.get("xsec_token")
        navigation_url = record["content_url"]
        if isinstance(token, str) and token:
            navigation_url += "?" + urlencode({"xsec_token": token, "xsec_source": "pc_search"})
        entries.append({"record": record, "navigation_url": navigation_url})
    cursor = data.get("cursor") if isinstance(data.get("cursor"), str) else None
    return entries, cursor, bool(data.get("has_more"))


def _normalize_comment(
    raw: Any, *, content_id: str, parent_comment_id: str | None = None, fetched_at: str,
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    comment_id = raw.get("id")
    text = raw.get("content")
    if not isinstance(comment_id, str) or not comment_id or not isinstance(text, str) or not text.strip():
        return None
    user = raw.get("user_info") if isinstance(raw.get("user_info"), dict) else {}
    return {
        "content_id": content_id,
        "comment_id": comment_id,
        "parent_comment_id": parent_comment_id,
        "author_display_name": user.get("nickname") if isinstance(user.get("nickname"), str) else None,
        "text": text.strip(),
        "like_count": number(raw.get("like_count")),
        "published_at": timestamp(raw.get("create_time")),
        "fetched_at": fetched_at,
        "ip_location": raw.get("ip_location") if isinstance(raw.get("ip_location"), str) else None,
        "platform_extra": {
            "sub_comment_count": number(raw.get("sub_comment_count")),
        },
    }


def comments_from_payload(payload: Any, *, content_id: str) -> tuple[list[dict[str, Any]], str | None, bool]:
    data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else None
    if data is None or not isinstance(data.get("comments"), list):
        raise CollectorError("PAGE_CHANGED", "小红书评论响应缺少 data.comments")
    fetched_at = utc_now()
    comments: list[dict[str, Any]] = []
    for raw in data["comments"]:
        parent = _normalize_comment(raw, content_id=content_id, fetched_at=fetched_at)
        if parent is not None:
            comments.append(parent)
        parent_id = raw.get("id") if isinstance(raw, dict) and isinstance(raw.get("id"), str) else None
        replies = raw.get("sub_comments") if isinstance(raw, dict) else None
        if not isinstance(replies, list) and isinstance(raw, dict):
            replies = raw.get("comments")
        if isinstance(replies, list) and parent_id:
            for reply in replies:
                child = _normalize_comment(
                    reply, content_id=content_id, parent_comment_id=parent_id, fetched_at=fetched_at,
                )
                if child is not None:
                    comments.append(child)
    cursor = data.get("cursor") if isinstance(data.get("cursor"), str) else None
    return comments, cursor, bool(data.get("has_more"))
