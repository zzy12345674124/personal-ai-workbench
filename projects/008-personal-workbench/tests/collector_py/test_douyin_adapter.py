import unittest

from scripts.collector.core import CollectorError, validate_job
from scripts.collector.platforms.douyin import DouyinAdapter
from scripts.collector.platforms.douyin_parser import (
    comments_from_payload,
    contents_from_search_payload,
    safe_content_url,
)


class DouyinAdapterContractTests(unittest.TestCase):
    def test_normalizes_search_result_without_platform_tokens(self):
        payload = {
            "data": [{"aweme_info": {
                "aweme_id": "1234567890123456789", "desc": "虚构视频", "create_time": 1700000000,
                "aweme_type": 4, "author": {"nickname": "虚构作者", "sec_uid": "do-not-copy"},
                "statistics": {"digg_count": 7, "comment_count": 3, "play_count": 9, "share_count": 1},
                "status": {"is_delete": False, "is_private": False}, "a_bogus": "do-not-copy",
            }}], "cursor": 10, "has_more": 1,
        }
        items, cursor, has_more = contents_from_search_payload(payload)
        self.assertEqual(cursor, 10)
        self.assertTrue(has_more)
        self.assertEqual(items[0]["content_url"], "https://www.douyin.com/video/1234567890123456789")
        self.assertEqual(items[0]["author_display_name"], "虚构作者")
        self.assertNotIn("sec_uid", str(items[0]))
        self.assertNotIn("a_bogus", str(items[0]))

    def test_skips_private_or_malformed_search_items(self):
        payload = {"data": [
            {"aweme_info": {"aweme_id": "not-digits", "status": {}}},
            {"aweme_info": {"aweme_id": "123", "status": {"is_private": True}}},
        ], "has_more": 0}
        items, _, has_more = contents_from_search_payload(payload)
        self.assertEqual(items, [])
        self.assertFalse(has_more)

    def test_normalizes_comments_and_nested_replies(self):
        payload = {"comments": [{
            "cid": "comment-1", "text": "虚构评论", "create_time": 1700000000,
            "digg_count": 2, "ip_label": "虚构地区", "reply_id": "0",
            "reply_comment_total": 1, "is_hot": True, "level": 1,
            "user": {"nickname": "虚构用户", "uid": "do-not-copy"},
            "reply_comment": [{"cid": "reply-1", "text": "虚构回复", "create_time": 1700000001,
                               "user": {"nickname": "虚构回复者"}}],
        }], "cursor": 20, "has_more": 0}
        comments, cursor, has_more = comments_from_payload(payload, content_id="video-1")
        self.assertEqual(cursor, 20)
        self.assertFalse(has_more)
        self.assertEqual(comments[0]["comment_id"], "comment-1")
        self.assertEqual(comments[1]["parent_comment_id"], "comment-1")
        self.assertNotIn("uid", str(comments))

    def test_rejects_changed_response_contract(self):
        with self.assertRaises(CollectorError) as search_error:
            contents_from_search_payload({"items": []})
        self.assertEqual(search_error.exception.code, "PAGE_CHANGED")
        with self.assertRaises(CollectorError) as comment_error:
            comments_from_payload({"items": []}, content_id="video-1")
        self.assertEqual(comment_error.exception.code, "PAGE_CHANGED")

    def test_content_url_has_strict_host_and_numeric_id(self):
        self.assertEqual(safe_content_url("https://www.douyin.com/video/1234567890123456789?from=search"),
                         "https://www.douyin.com/video/1234567890123456789")
        self.assertIsNone(safe_content_url("https://evil.example/video/1234567890123456789"))
        self.assertIsNone(safe_content_url("https://www.douyin.com/video/not-number"))

    def test_visible_login_button_marks_cookie_as_expired(self):
        class Locator:
            def inner_text(self, timeout):
                return ""

            def count(self):
                return 1

        class Page:
            def locator(self, _selector):
                return Locator()

            def get_by_role(self, *_args, **_kwargs):
                return Locator()

        adapter = DouyinAdapter(validate_job({"platform": "douyin", "keywords": ["虚构词"]}))
        adapter._page = Page()
        self.assertEqual(adapter.current_login_state(), "login_required")


if __name__ == "__main__":
    unittest.main()
