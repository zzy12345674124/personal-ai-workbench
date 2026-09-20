"""B站平台专属层：监听公开页面响应，低频限量采集评论。"""

from __future__ import annotations

import os
import random
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

from ..core import CollectorError
from .base import PlatformAdapter
from .bilibili_parser import (
    comments_from_payload,
    content_from_dom,
    contents_from_search_payload,
    safe_content_url,
)


class BilibiliAdapter(PlatformAdapter):
    platform = "bilibili"
    version = "0.1.2"
    ready = True

    def __init__(self, job: dict[str, Any]):
        super().__init__(job)
        profile_root = Path(os.environ.get("COLLECTOR_PROFILE_ROOT", Path.home() / ".cloakbrowser" / "profiles"))
        self.profile_dir = (profile_root / "bilibili").resolve()
        self._manager: Any = None
        self._context: Any = None
        self._page: Any = None
        self._search_items: list[dict[str, Any]] = []
        self._comments: list[dict[str, Any]] = []
        self._content_id = ""
        self._search_has_more = True
        self._comment_has_more = True
        self._search_pages = 0
        self._comment_pages = 0
        self._parse_error: CollectorError | None = None

    def _ensure_browser(self) -> None:
        if self._context is not None:
            return
        if os.name == "nt" and not os.environ.get("PROCESSOR_ARCHITECTURE"):
            os.environ["PROCESSOR_ARCHITECTURE"] = "AMD64" if sys.maxsize > 2**32 else "x86"
        from cloakbrowser import launch_persistent_context

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self._manager = launch_persistent_context(str(self.profile_dir), headless=not self.job["browser"]["visible"])
        self._context = self._manager.__enter__()
        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()
        self._page.on("response", self._on_response)

    def _on_response(self, response: Any) -> None:
        path = urlsplit(response.url).path
        is_search = path.endswith("/x/web-interface/wbi/search/type") or path.endswith("/x/web-interface/search/type")
        is_comment = path.endswith("/x/v2/reply/wbi/main") or path.endswith("/x/v2/reply/main")
        if response.status != 200 or not (is_search or is_comment):
            return
        try:
            payload = response.json()
            if is_search:
                items, _, self._search_has_more = contents_from_search_payload(payload)
                known = {item["content_id"] for item in self._search_items}
                for item in items:
                    if item["content_id"] not in known:
                        self._search_items.append(item)
                        known.add(item["content_id"])
                self._search_pages += 1
            elif self._content_id:
                items, _, self._comment_has_more = comments_from_payload(payload, content_id=self._content_id)
                known = {item["comment_id"] for item in self._comments}
                for item in items:
                    if item["comment_id"] not in known:
                        self._comments.append(item)
                        known.add(item["comment_id"])
                self._comment_pages += 1
        except CollectorError as error:
            self._parse_error = error
        except Exception:
            self._parse_error = CollectorError("PAGE_CHANGED")

    def _wait_action(self, minimum_ms: int = 0) -> None:
        self.control_point()
        timing = self.job["timing"]
        low = max(minimum_ms, timing["minActionDelayMs"])
        high = max(low, timing["maxActionDelayMs"])
        self._page.wait_for_timeout(random.randint(low, high))
        self.control_point()

    def _body_text(self) -> str:
        try:
            return self._page.locator("body").inner_text(timeout=3_000)
        except Exception:
            return ""

    def _check_blockers(self) -> None:
        text = self._body_text()
        if any(marker in text for marker in ("安全验证", "请完成验证", "滑动验证", "验证后继续")):
            raise CollectorError("HUMAN_CHECK_REQUIRED")
        if any(marker in text for marker in ("请求过于频繁", "访问频繁", "操作频繁", "稍后再试")):
            raise CollectorError("RATE_LIMITED")

    def _append_search_item(self, item: dict[str, Any] | None) -> None:
        if item is None:
            return
        if any(existing["content_id"] == item["content_id"] for existing in self._search_items):
            return
        self._search_items.append(item)

    def _collect_dom_search_items(self) -> None:
        """搜索接口未暴露结果时，从公开搜索页卡片读取同一批字段。"""
        if self._page is None:
            return
        limit = self.job["limits"]["maxContentsPerKeyword"]
        try:
            cards = self._page.locator(".bili-video-card")
            card_count = min(cards.count(), max(limit * 3, 20))
        except Exception:
            cards = None
            card_count = 0

        for index in range(card_count):
            try:
                card = cards.nth(index)
                link = card.locator('a[href*="/video/BV"]').first
                href = link.get_attribute("href", timeout=1_000)
                title_node = card.locator("h3[title]").first
                title = title_node.get_attribute("title", timeout=1_000)
                if not title:
                    title = title_node.inner_text(timeout=1_000)
                author = card.locator(".bili-video-card__info--author").first.inner_text(timeout=1_000)
                self._append_search_item(content_from_dom(href=href, title=title, author=author))
            except Exception:
                continue

        if self._search_items:
            return
        try:
            links = self._page.locator('a[href*="/video/BV"]')
            link_count = min(links.count(), max(limit * 6, 60))
        except Exception:
            return
        for index in range(link_count):
            try:
                link = links.nth(index)
                href = link.get_attribute("href", timeout=1_000)
                title = link.get_attribute("title", timeout=1_000) or link.get_attribute("aria-label", timeout=1_000)
                if not title:
                    title = link.inner_text(timeout=1_000)
                self._append_search_item(content_from_dom(href=href, title=title, author=""))
            except Exception:
                continue

    def check_login(self) -> str:
        self._ensure_browser()
        self.control_point()
        self._page.goto("https://www.bilibili.com/", wait_until="domcontentloaded", timeout=60_000)
        self._wait_action(2_500)
        try:
            self._check_blockers()
        except CollectorError as error:
            if error.code == "HUMAN_CHECK_REQUIRED":
                return "human_check_required"
            raise
        return self.current_login_state()

    def current_login_state(self) -> str:
        try:
            self._check_blockers()
        except CollectorError as error:
            if error.code == "HUMAN_CHECK_REQUIRED":
                return "human_check_required"
            raise
        try:
            payload = self._page.evaluate("""
                async () => {
                  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
                    credentials: 'include'
                  });
                  return await response.json();
                }
            """)
            data = payload.get("data") if isinstance(payload, dict) else None
            if isinstance(data, dict) and isinstance(data.get("isLogin"), bool):
                return "logged_in" if data["isLogin"] else "login_required"
        except Exception:
            pass
        raise CollectorError("LOGIN_CHECK_FAILED", "无法验证B站登录状态")

    def search_contents(self, keyword: str) -> list[dict[str, Any]]:
        self._ensure_browser()
        self._search_items = []
        self._search_has_more = True
        self._search_pages = 0
        self._parse_error = None
        limit = self.job["limits"]["maxContentsPerKeyword"]
        self._page.goto(
            f"https://search.bilibili.com/video?keyword={quote(keyword, safe='')}",
            wait_until="domcontentloaded", timeout=60_000,
        )
        for _ in range(10):
            self._wait_action(2_500)
            self._check_blockers()
            self.require_login()
            self._collect_dom_search_items()
            if len(self._search_items) >= limit or (self._search_pages and not self._search_has_more):
                break
            self._page.mouse.wheel(0, random.randint(650, 950))
        if self._parse_error is not None and not self._search_items:
            raise self._parse_error
        if not self._search_items:
            raise CollectorError("PAGE_CHANGED", "未收到B站搜索数据")
        return self._search_items[:limit]

    def collect_comments(self, content: dict[str, Any]) -> list[dict[str, Any]]:
        self._ensure_browser()
        content_url = safe_content_url(content.get("content_url"))
        if content_url is None:
            raise CollectorError("BAD_CONTENT_URL")
        self._content_id = content["content_id"]
        self._comments = []
        self._comment_has_more = True
        self._comment_pages = 0
        self._parse_error = None
        self._page.goto(content_url, wait_until="domcontentloaded", timeout=60_000)
        page_limit = self.job["limits"]["maxPagesPerContent"]
        comment_limit = self.job["limits"]["maxCommentsPerContent"]
        unchanged = 0
        previous_count = -1
        for _ in range(page_limit):
            self._wait_action(2_500)
            self._check_blockers()
            self.require_login()
            if len(self._comments) >= comment_limit or (self._comment_pages and not self._comment_has_more):
                break
            unchanged = unchanged + 1 if len(self._comments) == previous_count else 0
            previous_count = len(self._comments)
            if unchanged >= 2:
                break
            self._page.mouse.wheel(0, random.randint(900, 1400))
        if self._parse_error is not None and not self._comments:
            raise self._parse_error
        content_filter = self.job.get("contentFilter", "")
        comments = self._comments
        if content_filter:
            comments = [comment for comment in comments if content_filter in comment["text"]]
        return comments[:comment_limit]

    def close(self) -> None:
        if self._manager is not None:
            try:
                self._manager.__exit__(None, None, None)
            finally:
                self._manager = None
                self._context = None
                self._page = None
