import json
import tempfile
import unittest
from pathlib import Path

from scripts.collector.core import CollectorError, CollectorStorage, validate_job
from scripts.collector.platforms.base import PlatformAdapter
from scripts.collector.runner import JobControl, run_job


def valid_job():
    return {"platform": "douyin", "keywords": ["教材", "教材"]}


class FakeAdapter(PlatformAdapter):
    platform = "douyin"
    version = "test-1"
    ready = True

    def check_login(self):
        return "logged_in"

    def search_contents(self, keyword):
        return [{"content_id": "video-1", "content_url": "https://example.invalid/video-1", "title": "虚构视频"}]

    def collect_comments(self, content):
        return [{"content_id": content["content_id"], "comment_id": "comment-1", "text": "虚构评论"}]


class FailingAdapter(FakeAdapter):
    def search_contents(self, keyword):
        raise CollectorError("PAGE_CHANGED")


class CoolingAdapter(FakeAdapter):
    def __init__(self, job):
        super().__init__(job)
        self.search_calls = 0

    def search_contents(self, keyword):
        self.search_calls += 1
        if self.search_calls == 1:
            raise CollectorError("RATE_LIMITED")
        return super().search_contents(keyword)


class RepeatedCommentRateLimitAdapter(FakeAdapter):
    def collect_comments(self, content):
        raise CollectorError("RATE_LIMITED")


class InitiallyExpiredAdapter(FakeAdapter):
    def check_login(self):
        return "login_required"

    def current_login_state(self):
        return "logged_in"


class MidTaskExpiredAdapter(FakeAdapter):
    def __init__(self, job):
        super().__init__(job)
        self.search_calls = 0

    def current_login_state(self):
        return "logged_in"

    def search_contents(self, keyword):
        self.search_calls += 1
        if self.search_calls == 1:
            raise CollectorError("LOGIN_REQUIRED")
        return super().search_contents(keyword)


class CollectorCoreTests(unittest.TestCase):
    def test_validate_job_defaults_and_deduplicates(self):
        job = validate_job(valid_job())
        self.assertEqual(job["keywords"], ["教材"])
        self.assertEqual(job["limits"]["maxCommentsPerContent"], 100)
        self.assertTrue(job["browser"]["visible"])

    def test_rejects_background_and_excessive_limits(self):
        with self.assertRaisesRegex(CollectorError, "BACKGROUND_NOT_APPROVED"):
            validate_job({**valid_job(), "browser": {"visible": False}})
        with self.assertRaisesRegex(CollectorError, "BAD_LIMITS"):
            validate_job({**valid_job(), "limits": {"maxRuntimeMinutes": 481}})

    def test_storage_rejects_output_path(self):
        with tempfile.TemporaryDirectory() as root:
            storage = CollectorStorage(root)
            with self.assertRaisesRegex(CollectorError, "BAD_OUTPUT_NAME"):
                storage.write_json("../cookie.json", {"secret": True})

    def test_state_machine_rejects_illegal_jump(self):
        with tempfile.TemporaryDirectory() as root:
            storage = CollectorStorage(root)
            storage.write_json("status.json", {"state": "queued"})
            with self.assertRaises(CollectorError):
                storage.set_state("completed")

    def test_control_file_pauses_resumes_and_stops_at_safe_point(self):
        with tempfile.TemporaryDirectory() as root:
            storage = CollectorStorage(root)
            storage.write_json("status.json", {"state": "searching"})
            sleep_calls = []

            def resume_after_one_sleep(seconds):
                sleep_calls.append(seconds)
                storage.write_json("control.json", {"action": "run"})

            storage.write_json("control.json", {"action": "pause"})
            control = JobControl(storage, sleep=resume_after_one_sleep)
            control.point()
            self.assertEqual(sleep_calls, [0.25])
            self.assertEqual(storage.read_status()["state"], "searching")
            storage.write_json("control.json", {"action": "stop"})
            with self.assertRaisesRegex(CollectorError, "STOPPED_BY_USER"):
                control.point()

    def test_runner_uses_only_fake_data_and_writes_standard_files(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "job.json"
            path.write_text(json.dumps({**valid_job(), "jobId": "collector-douyin-test-123456"}), encoding="utf-8")
            code = run_job(path, FakeAdapter)
            self.assertEqual(code, 0)
            status = json.loads((Path(root) / "status.json").read_text(encoding="utf-8"))
            self.assertEqual(status["state"], "completed")
            self.assertEqual(status["contentCount"], 1)
            self.assertEqual(status["commentCount"], 1)
            self.assertIn("example.invalid", (Path(root) / "contents.jsonl").read_text(encoding="utf-8"))
            checkpoint = json.loads((Path(root) / "checkpoint.json").read_text(encoding="utf-8"))
            summary = json.loads((Path(root) / "summary.json").read_text(encoding="utf-8"))
            self.assertTrue(checkpoint["completed"])
            self.assertEqual(summary, {"state": "completed", "code": None, "contentCount": 1, "commentCount": 1})

    def test_runner_failure_also_writes_summary(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "job.json"
            path.write_text(json.dumps({**valid_job(), "jobId": "collector-douyin-test-123456"}), encoding="utf-8")
            code = run_job(path, FailingAdapter)
            self.assertEqual(code, 2)
            summary = json.loads((Path(root) / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["state"], "failed")
            self.assertEqual(summary["code"], "PAGE_CHANGED")

    def test_rate_limit_cools_down_once_then_retries(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "job.json"
            path.write_text(json.dumps({**valid_job(), "jobId": "collector-douyin-test-123456"}), encoding="utf-8")
            code = run_job(path, CoolingAdapter, sleep=lambda _seconds: None)
            self.assertEqual(code, 0)
            events = (Path(root) / "events.jsonl").read_text(encoding="utf-8")
            self.assertIn('"state":"cooling_down"', events)

    def test_second_rate_limit_preserves_existing_result_as_partial(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "job.json"
            path.write_text(json.dumps({**valid_job(), "jobId": "collector-douyin-test-123456"}), encoding="utf-8")
            code = run_job(path, RepeatedCommentRateLimitAdapter, sleep=lambda _seconds: None)
            self.assertEqual(code, 2)
            summary = json.loads((Path(root) / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["state"], "partial")
            self.assertEqual(summary["contentCount"], 1)
            self.assertEqual(summary["code"], "RATE_LIMITED")

    def test_expired_login_waits_then_continues_without_reentering_job(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "job.json"
            path.write_text(json.dumps({**valid_job(), "jobId": "collector-douyin-test-123456"}), encoding="utf-8")
            notifications = []
            code = run_job(
                path, InitiallyExpiredAdapter, sleep=lambda _seconds: None,
                notify=lambda platform, state: notifications.append((platform, state)),
            )
            self.assertEqual(code, 0)
            self.assertEqual(notifications, [("douyin", "waiting_login")])
            events = (Path(root) / "events.jsonl").read_text(encoding="utf-8")
            self.assertIn('"state":"waiting_login"', events)
            self.assertEqual(json.loads((Path(root) / "status.json").read_text(encoding="utf-8"))["state"], "completed")

    def test_mid_task_cookie_expiry_retries_current_step_after_login(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "job.json"
            path.write_text(json.dumps({**valid_job(), "jobId": "collector-douyin-test-123456"}), encoding="utf-8")
            code = run_job(
                path, MidTaskExpiredAdapter, sleep=lambda _seconds: None,
                notify=lambda _platform, _state: None,
            )
            self.assertEqual(code, 0)
            events = (Path(root) / "events.jsonl").read_text(encoding="utf-8")
            self.assertIn('"state":"waiting_login"', events)


if __name__ == "__main__":
    unittest.main()
