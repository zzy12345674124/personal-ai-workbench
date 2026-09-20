"""抖音平台专属层：CloakBrowser 页面响应监听和限量翻页。"""

from __future__ import annotations

import os
import random
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

from ..core import CollectorError
from .base import PlatformAdapter
from .douyin_parser import comments_from_payload, contents_from_search_payload, safe_content_url


SEARCH_PATH = "/aweme/v1/web/search/item/"
COMMENT_PATH = "/aweme/v1/web/comment/list/"


class DouyinAdapter(PlatformAdapter):
    platform = "douyin"
    version = "0.1.1"
    ready = True

    def __init__(self, job: dict[str, Any]):
        super().__init__(job)
        profile_root = Path(os.environ.get("COLLECTOR_PROFILE_ROOT", Path.home() / ".cloakbrowser" / "profiles"))
        self.profile_dir = (profile_root / "douyin").resolve()
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
        self._manager = launch_persistent_context(
            str(self.profile_dir), headless=not self.job["browser"]["visible"],
        )
        self._context = self._manager.__enter__()
        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()
        self._page.on("response", self._on_response)

    def _on_response(self, response: Any) -> None:
        path = urlsplit(response.url).path
        if path not in {SEARCH_PATH, COMMENT_PATH} or response.status != 200:
            return
        try:
            payload = response.json()
            if path == SEARCH_PATH:
                items, _, self._search_has_more = contents_from_search_payload(payload)
                known = {item["content_id"] for item in self._search_items}
                self._search_items.extend(item for item in items if item["content_id"] not in known)
                self._search_pages += 1
            elif self._content_id:
                items, _, self._comment_has_more = comments_from_payload(payload, content_id=self._content_id)
                known = {item["comment_id"] for item in self._comments}
                self._comments.extend(item for item in items if item["comment_id"] not in known)
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

    def _page_markers(self) -> tuple[bool, bool, bool]:
        try:
            text = self._page.locator("body").inner_text(timeout=3_000)
        except Exception:
            text = ""
        human_check = any(marker in text for marker in ("安全验证", "滑块验证"))
        login_required = any(marker in text for marker in ("扫码登录", "手机号登录", "验证码登录"))
        try:
            login_required = login_required or self._page.get_by_role("button", name="登录", exact=True).count() > 0
        except Exception:
            pass
        rate_limited = any(marker in text for marker in ("访问太频繁", "操作频繁", "请求过于频繁", "休息一下"))
        return login_required, human_check, rate_limited

    def _check_page_blockers(self) -> tuple[bool, bool]:
        login_required, human_check, rate_limited = self._page_markers()
        if rate_limited:
            raise CollectorError("RATE_LIMITED")
        return login_required, human_check

    def check_login(self) -> str:
        self._ensure_browser()
        self.control_point()
        self._page.goto("https://www.douyin.com/", wait_until="domcontentloaded", timeout=60_000)
        self._wait_action(3_000)
        return self.current_login_state()

    def current_login_state(self) -> str:
        login_required, human_check = self._check_page_blockers()
        if human_check:
            return "human_check_required"
        return "login_required" if login_required else "logged_in"

    def search_contents(self, keyword: str) -> list[dict[str, Any]]:
        self._ensure_browser()
        self.control_point()
        self._search_items = []
        self._search_has_more = True
        self._search_pages = 0
        self._parse_error = None
        limit = self.job["limits"]["maxContentsPerKeyword"]
        self._page.goto(
            f"https://www.douyin.com/search/{quote(keyword, safe='')}?type=video",
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
            raise CollectorError("PAGE_CHANGED", "未收到抖音搜索数据")
        return self._search_items[:limit]

    def _scroll_comment_panel(self) -> bool:
        return bool(self._page.evaluate("""
            () => {
              const candidates = Array.from(document.querySelectorAll('*')).filter((el) => {
                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return rect.width > 240 && rect.height > 180 && el.scrollHeight > el.clientHeight + 80
                  && ['auto', 'scroll'].includes(style.overflowY);
              });
              candidates.sort((a, b) => {
                const score = (el) => {
                  const rect = el.getBoundingClientRect();
                  const commentHint = (el.textContent || '').includes('评论') ? 1000000 : 0;
                  const rightHint = rect.left > innerWidth * 0.4 ? 500000 : 0;
                  return commentHint + rightHint + el.scrollHeight - el.clientHeight;
                };
                return score(b) - score(a);
              });
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
        self._comments = []
        self._comment_has_more = True
        self._comment_pages = 0
        self._parse_error = None
        self._page.goto(content_url, wait_until="domcontentloaded", timeout=60_000)
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
