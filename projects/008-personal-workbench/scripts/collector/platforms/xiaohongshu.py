"""小红书平台专属层：CloakBrowser 响应监听、限量搜索与评论翻页。"""

from __future__ import annotations

import os
import random
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

from ..core import CollectorError
from .base import PlatformAdapter
from .xiaohongshu_parser import comments_from_payload, safe_content_url, search_entries_from_payload


SEARCH_PATH = "/api/sns/web/v2/search/notes"
COMMENT_PATH_FRAGMENT = "/comment/page"


class XiaohongshuAdapter(PlatformAdapter):
    platform = "xiaohongshu"
    version = "0.1.1"
    ready = True

    def __init__(self, job: dict[str, Any]):
        super().__init__(job)
        profile_root = Path(os.environ.get("COLLECTOR_PROFILE_ROOT", Path.home() / ".cloakbrowser" / "profiles"))
        # 沿用已登录的小红书独立资料目录，不与抖音共用。
        self.profile_dir = (profile_root / "xhs").resolve()
        self._manager: Any = None
        self._context: Any = None
        self._page: Any = None
        self._search_items: list[dict[str, Any]] = []
        self._navigation_urls: dict[str, str] = {}
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
        self._manager = launch_persistent_context(
            str(self.profile_dir), headless=not self.job["browser"]["visible"],
        )
        self._context = self._manager.__enter__()
        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()
        self._page.on("response", self._on_response)

    def _on_response(self, response: Any) -> None:
        path = urlsplit(response.url).path
        if response.status != 200 or (path != SEARCH_PATH and COMMENT_PATH_FRAGMENT not in path):
            return
        try:
            payload = response.json()
            if path == SEARCH_PATH:
                entries, _, self._search_has_more = search_entries_from_payload(payload)
                known = {item["content_id"] for item in self._search_items}
                for entry in entries:
                    record = entry["record"]
                    self._navigation_urls[record["content_id"]] = entry["navigation_url"]
                    if record["content_id"] not in known:
                        self._search_items.append(record)
                        known.add(record["content_id"])
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

    def _page_markers(self) -> tuple[bool, bool, bool]:
        text = self._body_text()
        path = urlsplit(self._page.url).path.lower()
        human_check = any(marker in text for marker in ("安全验证", "拖动滑块", "请完成验证", "请通过验证"))
        login_required = "/login" in path or any(
            marker in text for marker in ("扫码登录", "手机号登录", "登录后查看更多", "登录后查看")
        )
        rate_limited = any(marker in text for marker in ("操作频繁", "访问频繁", "请求频繁", "请稍后再试"))
        return login_required, human_check, rate_limited

    def _check_page_blockers(self) -> tuple[bool, bool]:
        login_required, human_check, rate_limited = self._page_markers()
        if rate_limited:
            raise CollectorError("RATE_LIMITED")
        return login_required, human_check

    def check_login(self) -> str:
        self._ensure_browser()
        self.control_point()
        self._page.goto("https://www.xiaohongshu.com/explore", wait_until="domcontentloaded", timeout=60_000)
        self._wait_action(3_000)
        return self.current_login_state()

    def current_login_state(self) -> str:
        login_required, human_check = self._check_page_blockers()
        if human_check:
            return "human_check_required"
        try:
            profile = self._page.evaluate("""
                async () => {
                  const response = await fetch('/user/profile', {redirect: 'follow'});
                  return {url: response.url, status: response.status};
                }
            """)
            profile_url = profile.get("url") if isinstance(profile, dict) else None
            if isinstance(profile_url, str):
                return "login_required" if "/login" in urlsplit(profile_url).path.lower() else "logged_in"
        except Exception:
            pass
        return "login_required" if login_required else "logged_in"

    def search_contents(self, keyword: str) -> list[dict[str, Any]]:
        self._ensure_browser()
        self.control_point()
        self._search_items = []
        self._navigation_urls = {}
        self._search_has_more = True
        self._search_pages = 0
        self._parse_error = None
        limit = self.job["limits"]["maxContentsPerKeyword"]
        self._page.goto(
            f"https://www.xiaohongshu.com/search_result?keyword={quote(keyword, safe='')}&type=51",
            wait_until="domcontentloaded", timeout=60_000,
        )
        for _ in range(10):
            self.control_point()
            self._wait_action(3_000)
            self.require_login()
            if len(self._search_items) >= limit or (self._search_pages and not self._search_has_more):
                break
            self._page.mouse.wheel(0, random.randint(650, 950))
        if self._parse_error is not None and not self._search_items:
            raise self._parse_error
        if not self._search_items:
            raise CollectorError("PAGE_CHANGED", "未收到小红书搜索数据")
        return self._search_items[:limit]

    def _scroll_comment_panel(self) -> bool:
        return bool(self._page.evaluate("""
            () => {
              const candidates = Array.from(document.querySelectorAll('div,section')).filter((el) => {
                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return rect.width > 240 && rect.height > 180 && el.scrollHeight > el.clientHeight + 40
                  && ['auto', 'scroll'].includes(style.overflowY);
              });
              candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
              const target = candidates[0];
              if (!target) return false;
              target.scrollBy({top: Math.max(500, target.clientHeight * 0.8), behavior: 'auto'});
              return true;
            }
        """))

    def collect_comments(self, content: dict[str, Any]) -> list[dict[str, Any]]:
        self._ensure_browser()
        self.control_point()
        content_url = safe_content_url(content.get("content_url"))
        if content_url is None:
            raise CollectorError("BAD_CONTENT_URL")
        self._content_id = content["content_id"]
        navigation_url = self._navigation_urls.get(self._content_id, content_url)
        self._comments = []
        self._comment_has_more = True
        self._comment_pages = 0
        self._parse_error = None
        self._page.goto(navigation_url, wait_until="domcontentloaded", timeout=60_000)
        max_pages = self.job["limits"]["maxPagesPerContent"]
        comment_limit = self.job["limits"]["maxCommentsPerContent"]
        unchanged = 0
        previous_count = -1
        for _ in range(max_pages):
            self.control_point()
            self._wait_action(3_000)
            self.require_login()
            if len(self._comments) >= comment_limit or (self._comment_pages and not self._comment_has_more):
                break
            unchanged = unchanged + 1 if len(self._comments) == previous_count else 0
            previous_count = len(self._comments)
            if unchanged >= 2 or not self._scroll_comment_panel():
                break
        if self._parse_error is not None and not self._comments:
            raise self._parse_error
        if not self._comments and self._comment_pages == 0 and "暂无评论" not in self._body_text():
            raise CollectorError("PAGE_CHANGED", "未收到小红书评论数据")
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
