"""单个平台、单个任务的本地采集入口。"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Callable

from .core import CollectorError, CollectorStorage, utc_now, validate_job
from .platforms import ADAPTERS
from .platforms.base import PlatformAdapter


PLATFORM_NAMES = {"douyin": "抖音", "xiaohongshu": "小红书", "bilibili": "B站"}


class JobControl:
    """用任务目录中的小型控制文件实现跨进程暂停、继续和停止。"""

    def __init__(self, storage: CollectorStorage, sleep: Callable[[float], None] = time.sleep):
        self.storage = storage
        self.sleep = sleep
        self.control_path = storage.job_dir / "control.json"

    def _action(self) -> str:
        try:
            payload = json.loads(self.control_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return "run"
        action = payload.get("action")
        return action if action in {"run", "pause", "stop"} else "run"

    def checkpoint(self, **position: Any) -> None:
        self.storage.write_json("checkpoint.json", {**position, "updatedAt": utc_now()})

    def point(self) -> None:
        action = self._action()
        if action == "stop":
            raise CollectorError("STOPPED_BY_USER")
        if action != "pause":
            return
        current = self.storage.read_status().get("state")
        if current not in {"checking_login", "searching", "collecting_comments", "cooling_down"}:
            return
        self.storage.set_state("paused", resumeState=current)
        while self._action() == "pause":
            self.sleep(0.25)
        if self._action() == "stop":
            raise CollectorError("STOPPED_BY_USER")
        self.storage.set_state(current, resumeState=None)


def _write_summary(storage: CollectorStorage, state: str, code: str | None = None) -> None:
    status = storage.read_status()
    storage.write_json(
        "summary.json",
        {
            "state": state,
            "code": code,
            "contentCount": status.get("contentCount", 0),
            "commentCount": status.get("commentCount", 0),
        },
    )


def _call_with_one_cooldown(
    callback: Callable[[], Any], *, storage: CollectorStorage, control: JobControl,
    resume_state: str, cooldown_ms: int,
) -> Any:
    try:
        return callback()
    except CollectorError as error:
        if error.code != "RATE_LIMITED":
            raise
    storage.set_state("cooling_down", code="RATE_LIMITED")
    remaining = cooldown_ms / 1000
    while remaining > 0:
        control.point()
        step = min(0.5, remaining)
        control.sleep(step)
        remaining -= step
    storage.set_state(resume_state, code=None)
    return callback()


def _desktop_attention(platform: str, state: str) -> None:
    """只弹出操作提示；账号、密码与二维码均由平台页面自行处理。"""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        name = PLATFORM_NAMES.get(platform, platform)
        message = (
            f"{name}登录已失效。\n\n请在已打开的 CloakBrowser 中输入账号或扫描二维码。"
            if state == "waiting_login"
            else f"{name}需要人工验证。\n\n请在已打开的 CloakBrowser 中完成验证。"
        )
        ctypes.windll.user32.MessageBoxW(
            0, f"{message}\n\n成功后采集任务会自动继续。", "会话管家 - 采集需要人工操作", 0x30
        )
    except Exception:
        pass


def _wait_for_access(
    *, adapter: PlatformAdapter, storage: CollectorStorage, control: JobControl,
    resume_state: str, attention_state: str, sleep: Callable[[float], None],
    notify: Callable[[str, str], None], code: str | None = None,
) -> None:
    current_attention = attention_state
    messages = {
        "waiting_login": "登录已失效；请在 CloakBrowser 输入账号或扫码，成功后自动继续",
        "waiting_human_check": "请在 CloakBrowser 完成人工验证，通过后自动继续",
    }
    codes = {
        "waiting_login": code or "LOGIN_REQUIRED",
        "waiting_human_check": "HUMAN_CHECK_REQUIRED",
    }
    storage.set_state(
        current_attention, code=codes[current_attention], message=messages[current_attention],
        resumeState=resume_state,
    )
    notify(adapter.platform, current_attention)
    while True:
        control.point()
        sleep(3.0)
        try:
            login_state = adapter.current_login_state()
        except CollectorError as error:
            if error.code in {"LOGIN_CHECK_FAILED", "RATE_LIMITED"}:
                continue
            raise
        if login_state == "logged_in":
            storage.set_state(resume_state, code=None, message=None, resumeState=None)
            return
        next_attention = (
            "waiting_human_check" if login_state == "human_check_required" else "waiting_login"
        )
        if next_attention != current_attention:
            current_attention = next_attention
            storage.set_state(
                current_attention, code=codes[current_attention], message=messages[current_attention],
                resumeState=resume_state,
            )
            notify(adapter.platform, current_attention)


def _call_with_access_recovery(
    callback: Callable[[], Any], *, adapter: PlatformAdapter, storage: CollectorStorage,
    control: JobControl, resume_state: str, cooldown_ms: int,
    sleep: Callable[[float], None], notify: Callable[[str, str], None],
) -> Any:
    while True:
        try:
            return _call_with_one_cooldown(
                callback, storage=storage, control=control,
                resume_state=resume_state, cooldown_ms=cooldown_ms,
            )
        except CollectorError as error:
            if error.code not in {"LOGIN_REQUIRED", "HUMAN_CHECK_REQUIRED", "LOGIN_CHECK_FAILED"}:
                raise
            attention_state = (
                "waiting_human_check" if error.code == "HUMAN_CHECK_REQUIRED" else "waiting_login"
            )
            _wait_for_access(
                adapter=adapter, storage=storage, control=control, resume_state=resume_state,
                attention_state=attention_state, sleep=sleep, notify=notify, code=error.code,
            )


def run_job(
    job_path: str | Path,
    adapter_factory: Callable[[dict[str, Any]], PlatformAdapter] | None = None,
    sleep: Callable[[float], None] = time.sleep,
    notify: Callable[[str, str], None] = _desktop_attention,
) -> int:
    path = Path(job_path).resolve()
    storage = CollectorStorage(path.parent)
    control = JobControl(storage, sleep=sleep)
    adapter: PlatformAdapter | None = None
    content_count = 0
    comment_count = 0
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        job = validate_job(raw)
        job_id = raw.get("jobId")
        if not isinstance(job_id, str):
            raise CollectorError("BAD_JOB_ID")
        storage.set_state("starting", jobId=job_id, platform=job["platform"])
        factory = adapter_factory or ADAPTERS[job["platform"]]
        adapter = factory(job)
        adapter.bind_control(control.point)
        if not adapter.ready:
            raise CollectorError("PLATFORM_NOT_READY")
        storage.set_state("checking_login", adapterVersion=adapter.version)
        try:
            login_state = adapter.check_login()
        except CollectorError as error:
            if error.code != "LOGIN_CHECK_FAILED":
                raise
            login_state = "login_required"
        if login_state in {"login_required", "human_check_required"}:
            _wait_for_access(
                adapter=adapter, storage=storage, control=control, resume_state="checking_login",
                attention_state="waiting_human_check" if login_state == "human_check_required" else "waiting_login",
                sleep=sleep, notify=notify,
            )
        if login_state != "logged_in":
            # _wait_for_access 已在登录成功后返回；只拒绝合同外的未知状态。
            if login_state not in {"login_required", "human_check_required"}:
                raise CollectorError("BAD_LOGIN_STATE")

        storage.set_state("searching", contentCount=0, commentCount=0)
        control.checkpoint(keywordIndex=0, contentIndex=0, contentCount=0, commentCount=0)
        for keyword_index, keyword in enumerate(job["keywords"]):
            control.point()
            control.checkpoint(
                keywordIndex=keyword_index, keyword=keyword, contentIndex=0,
                contentCount=content_count, commentCount=comment_count,
            )
            contents = _call_with_access_recovery(
                lambda: adapter.search_contents(keyword), adapter=adapter, storage=storage, control=control,
                resume_state="searching", cooldown_ms=job["timing"]["cooldownAfterRateLimitMs"],
                sleep=sleep, notify=notify,
            )[: job["limits"]["maxContentsPerKeyword"]]
            for content_index, content in enumerate(contents):
                control.point()
                control.checkpoint(
                    keywordIndex=keyword_index, keyword=keyword, contentIndex=content_index,
                    contentId=content.get("content_id"), contentCount=content_count, commentCount=comment_count,
                )
                normalized_content = {**content, "platform": job["platform"], "job_id": job_id, "keyword": keyword}
                storage.append_jsonl("contents.jsonl", normalized_content)
                content_count += 1
                storage.set_state("collecting_comments", contentCount=content_count, commentCount=comment_count)
                comments = _call_with_access_recovery(
                    lambda: adapter.collect_comments(normalized_content), adapter=adapter, storage=storage, control=control,
                    resume_state="collecting_comments", cooldown_ms=job["timing"]["cooldownAfterRateLimitMs"],
                    sleep=sleep, notify=notify,
                )[: job["limits"]["maxCommentsPerContent"]]
                for comment in comments:
                    control.point()
                    storage.append_jsonl(
                        "comments.jsonl",
                        {**comment, "platform": job["platform"], "job_id": job_id, "keyword": keyword},
                    )
                    comment_count += 1
                control.checkpoint(
                    keywordIndex=keyword_index, keyword=keyword, contentIndex=content_index + 1,
                    contentId=content.get("content_id"), contentCount=content_count, commentCount=comment_count,
                )
                storage.set_state("searching", contentCount=content_count, commentCount=comment_count)
        storage.set_state("completed", contentCount=content_count, commentCount=comment_count)
        control.checkpoint(completed=True, contentCount=content_count, commentCount=comment_count)
        _write_summary(storage, "completed")
        return 0
    except CollectorError as error:
        current = storage.read_status()
        if error.code == "STOPPED_BY_USER" and current.get("state") not in {"stopped"}:
            try:
                storage.set_state("stopped", code=error.code)
                _write_summary(storage, "stopped", error.code)
            except CollectorError:
                pass
        elif error.code == "RATE_LIMITED" and (content_count or comment_count):
            try:
                storage.set_state("partial", code=error.code, message=str(error))
                _write_summary(storage, "partial", error.code)
            except CollectorError:
                pass
        elif current.get("state") not in {"waiting_login", "waiting_human_check"}:
            try:
                storage.set_state("failed", code=error.code, message=str(error))
                _write_summary(storage, "failed", error.code)
            except CollectorError:
                pass
        return 2
    except Exception as error:  # 最外层保证任务总有结构化终态，不把堆栈写入用户数据。
        try:
            storage.set_state("failed", code="UNEXPECTED", message=type(error).__name__)
            _write_summary(storage, "failed", "UNEXPECTED")
        except CollectorError:
            pass
        return 1
    finally:
        if adapter is not None:
            adapter.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    args = parser.parse_args(argv)
    return run_job(args.job)


if __name__ == "__main__":
    sys.exit(main())
