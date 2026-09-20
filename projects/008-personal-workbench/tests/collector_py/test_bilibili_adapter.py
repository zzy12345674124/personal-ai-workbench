import unittest

from scripts.collector.core import CollectorError, validate_job
from scripts.collector.login_bilibili import nav_is_logged_in
from scripts.collector.platforms.bilibili import BilibiliAdapter
from scripts.collector.platforms.bilibili_parser import (
    comments_from_payload,
    content_from_dom,
    contents_from_search_payload,
    safe_content_url,
)


class BilibiliParserTests(unittest.TestCase):
    def test_search_payload_maps_public_fields(self):
        items, page, has_more = contents_from_search_payload({
            "data": {"page": 1, "numPages": 2, "result": [{
                "bvid": "BV1AB411C7mD", "title": "<em>虚构</em>教材", "author": "测试作者",
                "pubdate": 1_700_000_000, "review": 12,
            }]},
        })
        self.assertEqual(page, 1)
        self.assertTrue(has_more)
        self.assertEqual(items[0]["title"], "虚构教材")
        self.assertEqual(items[0]["content_url"], "https://www.bilibili.com/video/BV1AB411C7mD")

    def test_comments_flatten_replies(self):
        items, cursor, has_more = comments_from_payload({"data": {
            "cursor": {"is_end": False, "next": 2},
            "replies": [{
                "rpid": 101, "member": {"uname": "甲"}, "content": {"message": "根评论"},
                "like": 3, "ctime": 1_700_000_001, "reply_control": {"location": "IP属地：上海"},
                "replies": [{"rpid": 102, "member": {"uname": "乙"}, "content": {"message": "回复"}, "like": 1}],
            }],
        }}, content_id="BV1AB411C7mD")
        self.assertEqual(cursor, "2")
        self.assertTrue(has_more)
        self.assertEqual([item["comment_id"] for item in items], ["101", "102"])
        self.assertEqual(items[1]["parent_comment_id"], "101")
        self.assertEqual(items[0]["ip_location"], "上海")

    def test_safe_url_and_bad_shape(self):
        self.assertEqual(safe_content_url("https://www.bilibili.com/video/BV1AB411C7mD?spm_id_from=x"), "https://www.bilibili.com/video/BV1AB411C7mD")
        self.assertIsNone(safe_content_url("https://example.invalid/video/BV1AB411C7mD"))
        with self.assertRaisesRegex(CollectorError, "PAGE_CHANGED"):
            contents_from_search_payload({"data": {}})

    def test_dom_card_maps_public_fields_and_rejects_external_url(self):
        item = content_from_dom(
            href="//www.bilibili.com/video/BV1AB411C7mD/?spm_id_from=search",
            title="<em>虚构</em>教材",
            author="测试作者",
        )
        self.assertIsNotNone(item)
        self.assertEqual(item["content_id"], "BV1AB411C7mD")
        self.assertEqual(item["content_url"], "https://www.bilibili.com/video/BV1AB411C7mD")
        self.assertEqual(item["title"], "虚构教材")
        self.assertIsNone(content_from_dom(
            href="https://example.invalid/video/BV1AB411C7mD", title="x", author="y",
        ))

    def test_malformed_nested_cursor_does_not_crash(self):
        items, cursor, has_more = comments_from_payload({"data": {
            "cursor": {"is_end": True, "pagination_reply": "unexpected"},
            "replies": [],
        }}, content_id="BV1AB411C7mD")
        self.assertEqual(items, [])
        self.assertEqual(cursor, "")
        self.assertFalse(has_more)

    def test_adapter_contract_ready(self):
        adapter = BilibiliAdapter(validate_job({"platform": "bilibili", "keywords": ["虚构词"]}))
        self.assertTrue(adapter.ready)
        self.assertEqual(adapter.platform, "bilibili")

    def test_login_probe_reads_only_boolean_contract(self):
        self.assertTrue(nav_is_logged_in({"data": {"isLogin": True, "uname": "not-read"}}))
        self.assertFalse(nav_is_logged_in({"data": {"isLogin": False}}))
        self.assertFalse(nav_is_logged_in({"unexpected": {}}))

    def test_adapter_requires_verified_bilibili_login(self):
        class Body:
            def inner_text(self, timeout):
                return ""

        class Page:
            def __init__(self, is_login):
                self.is_login = is_login

            def locator(self, _selector):
                return Body()

            def evaluate(self, _script):
                return {"data": {"isLogin": self.is_login}}

        adapter = BilibiliAdapter(validate_job({"platform": "bilibili", "keywords": ["虚构词"]}))
        adapter._page = Page(True)
        self.assertEqual(adapter.current_login_state(), "logged_in")
        adapter._page = Page(False)
        self.assertEqual(adapter.current_login_state(), "login_required")


if __name__ == "__main__":
    unittest.main()
