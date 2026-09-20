import unittest

from scripts.collector.probe_bilibili import sanitized_endpoint


class BilibiliProbeSanitizationTests(unittest.TestCase):
    def test_keeps_only_path_and_query_names(self):
        result = sanitized_endpoint(
            "https://api.bilibili.com/x/web-interface/wbi/search/type?keyword=secret&search_type=video"
        )
        self.assertEqual(result, {
            "host": "api.bilibili.com",
            "path": "/x/web-interface/wbi/search/type",
            "queryKeys": ["keyword", "search_type"],
        })
        self.assertNotIn("secret", str(result))

    def test_ignores_external_and_static_urls(self):
        self.assertIsNone(sanitized_endpoint("https://example.com/search?keyword=secret"))
        self.assertIsNone(sanitized_endpoint("https://s1.hdslb.com/static/search.js"))


if __name__ == "__main__":
    unittest.main()
