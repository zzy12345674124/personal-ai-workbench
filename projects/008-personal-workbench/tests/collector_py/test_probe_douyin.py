import unittest

from scripts.collector.probe_douyin import safe_video_url, sanitized_endpoint, schema_signature


class DouyinProbeSanitizationTests(unittest.TestCase):
    def test_endpoint_keeps_only_host_path_and_query_names(self):
        result = sanitized_endpoint(
            "https://www.douyin.com/aweme/v1/web/comment/list/?aweme_id=secret123&cursor=20&cursor=40"
        )
        self.assertEqual(result, {
            "host": "www.douyin.com",
            "path": "/aweme/v1/web/comment/list/",
            "queryKeys": ["aweme_id", "cursor"],
        })
        self.assertNotIn("secret123", str(result))

    def test_ignores_unrelated_or_external_responses(self):
        self.assertIsNone(sanitized_endpoint("https://example.com/aweme/v1/web/comment/list/?token=secret"))
        self.assertIsNone(sanitized_endpoint("https://www.douyin.com/static/app.js?token=secret"))

    def test_schema_keeps_types_not_values(self):
        signature = schema_signature({
            "comments": [{"text": "真实评论不能保存", "user": {"nickname": "真实昵称"}}],
            "cursor": 123,
            "has_more": True,
        })
        rendered = str(signature)
        self.assertIn("comments", rendered)
        self.assertIn("nickname", rendered)
        self.assertNotIn("真实评论不能保存", rendered)
        self.assertNotIn("真实昵称", rendered)
        self.assertNotIn("123", rendered)

    def test_video_navigation_accepts_only_public_douyin_video_path(self):
        self.assertEqual(
            safe_video_url("/video/1234567890123456789"),
            "https://www.douyin.com/video/1234567890123456789",
        )
        self.assertEqual(
            safe_video_url("//www.douyin.com/video/1234567890123456789?previous_page=search"),
            "https://www.douyin.com/video/1234567890123456789",
        )
        self.assertIsNone(safe_video_url("https://evil.example/video/1234567890123456789"))
        self.assertIsNone(safe_video_url("/user/1234567890123456789"))


if __name__ == "__main__":
    unittest.main()
