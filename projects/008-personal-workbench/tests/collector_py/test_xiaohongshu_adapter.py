import unittest

from scripts.collector.core import CollectorError
from scripts.collector.core import validate_job
from scripts.collector.platforms.xiaohongshu import XiaohongshuAdapter
from scripts.collector.platforms.xiaohongshu_parser import (
    comments_from_payload,
    safe_content_url,
    search_entries_from_payload,
)


class XiaohongshuAdapterContractTests(unittest.TestCase):
    def test_normalizes_search_without_persisting_navigation_token(self):
        payload = {"data": {"items": [{
            "id": "abcdef1234567890", "xsec_token": "do-not-persist",
            "note_card": {
                "display_title": "虚构笔记", "time": 1700000000000, "type": "normal",
                "user": {"nickname": "虚构作者", "user_id": "do-not-copy"},
                "interact_info": {"liked_count": "7", "comment_count": "3"},
            },
        }], "cursor": "cursor-1", "has_more": True}}
        entries, cursor, has_more = search_entries_from_payload(payload)
        self.assertEqual(cursor, "cursor-1")
        self.assertTrue(has_more)
        self.assertIn("xsec_token=", entries[0]["navigation_url"])
        self.assertEqual(entries[0]["record"]["content_url"], "https://www.xiaohongshu.com/explore/abcdef1234567890")
        self.assertNotIn("do-not-persist", str(entries[0]["record"]))
        self.assertNotIn("user_id", str(entries[0]["record"]))

    def test_normalizes_comments_and_nested_replies(self):
        payload = {"data": {"comments": [{
            "id": "comment-1", "content": "虚构评论", "like_count": "2",
            "create_time": 1700000000000, "ip_location": "虚构地区",
            "sub_comment_count": 1, "user_info": {"nickname": "虚构用户", "user_id": "secret"},
            "sub_comments": [{
                "id": "reply-1", "content": "虚构回复", "create_time": 1700000001000,
                "user_info": {"nickname": "虚构回复者"},
            }],
        }], "cursor": "cursor-2", "has_more": False}}
        comments, cursor, has_more = comments_from_payload(payload, content_id="note-1")
        self.assertEqual(cursor, "cursor-2")
        self.assertFalse(has_more)
        self.assertEqual(comments[0]["comment_id"], "comment-1")
        self.assertEqual(comments[1]["parent_comment_id"], "comment-1")
        self.assertNotIn("user_id", str(comments))

    def test_skips_image_only_empty_text_but_keeps_text_replies(self):
        payload = {"data": {"comments": [{
            "id": "comment-empty", "content": "", "user_info": {"nickname": "虚构用户"},
            "sub_comments": [
                {"id": "reply-empty", "content": "   ", "user_info": {"nickname": "虚构回复者"}},
                {"id": "reply-text", "content": "  虚构文字回复  ", "user_info": {"nickname": "虚构回复者"}},
            ],
        }], "cursor": "", "has_more": False}}
        comments, _, _ = comments_from_payload(payload, content_id="note-1")
        self.assertEqual(len(comments), 1)
        self.assertEqual(comments[0]["comment_id"], "reply-text")
        self.assertEqual(comments[0]["parent_comment_id"], "comment-empty")
        self.assertEqual(comments[0]["text"], "虚构文字回复")

    def test_rejects_changed_contract_and_unsafe_url(self):
        with self.assertRaises(CollectorError) as search_error:
            search_entries_from_payload({"items": []})
        self.assertEqual(search_error.exception.code, "PAGE_CHANGED")
        with self.assertRaises(CollectorError) as comment_error:
            comments_from_payload({"comments": []}, content_id="note-1")
        self.assertEqual(comment_error.exception.code, "PAGE_CHANGED")
        self.assertEqual(
            safe_content_url("https://www.xiaohongshu.com/explore/abcdef123456?xsec_token=secret"),
            "https://www.xiaohongshu.com/explore/abcdef123456",
        )
        self.assertIsNone(safe_content_url("https://evil.example/explore/abcdef123456"))

    def test_login_check_uses_verified_profile_redirect(self):
        class Locator:
            def inner_text(self, timeout):
                return ""

        class Page:
            def __init__(self, profile_url, body=""):
                self.url = "https://www.xiaohongshu.com/explore"
                self.profile_url = profile_url
                self.body = body

            def goto(self, *_args, **_kwargs):
                return None

            def wait_for_timeout(self, _milliseconds):
                return None

            def locator(self, _selector):
                locator = Locator()
                locator.inner_text = lambda timeout: self.body
                return locator

            def evaluate(self, _script):
                return {"url": self.profile_url, "status": 200}

        def state(profile_url, body=""):
            adapter = XiaohongshuAdapter(validate_job({"platform": "xiaohongshu", "keywords": ["虚构词"]}))
            adapter._context = object()
            adapter._page = Page(profile_url, body)
            return adapter.check_login()

        self.assertEqual(state("https://www.xiaohongshu.com/user/profile/fictional"), "logged_in")
        self.assertEqual(state("https://www.xiaohongshu.com/login"), "login_required")
        self.assertEqual(state("https://www.xiaohongshu.com/user/profile/fictional", "请完成验证"), "human_check_required")


if __name__ == "__main__":
    unittest.main()
