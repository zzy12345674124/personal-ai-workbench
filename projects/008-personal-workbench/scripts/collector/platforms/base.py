"""平台专属层必须遵守的最小合同。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Callable

from ..core import CollectorError


class PlatformAdapter(ABC):
    platform: str
    version: str
    ready: bool = False

    def __init__(self, job: dict[str, Any]):
        self.job = job
        self._control_point: Callable[[], None] = lambda: None

    def bind_control(self, callback: Callable[[], None]) -> None:
        """绑定公共任务控制点；平台层只调用，不读取控制文件。"""
        self._control_point = callback

    def control_point(self) -> None:
        self._control_point()

    @abstractmethod
    def check_login(self) -> str:
        """返回 logged_in、login_required 或 human_check_required。"""

    def current_login_state(self) -> str:
        """不重新导航，只检查当前页登录态；平台可覆盖以便登录时持续轮询。"""
        return self.check_login()

    def require_login(self) -> None:
        """采集过程中重新检查 Cookie，并用稳定错误码交回公共恢复流程。"""
        state = self.current_login_state()
        if state == "login_required":
            raise CollectorError("LOGIN_REQUIRED")
        if state == "human_check_required":
            raise CollectorError("HUMAN_CHECK_REQUIRED")
        if state != "logged_in":
            raise CollectorError("LOGIN_CHECK_FAILED")

    @abstractmethod
    def search_contents(self, keyword: str) -> list[dict[str, Any]]:
        """把平台搜索结果转换成公共内容字段。"""

    @abstractmethod
    def collect_comments(self, content: dict[str, Any]) -> list[dict[str, Any]]:
        """把平台评论转换成公共评论字段。"""

    def close(self) -> None:
        """释放浏览器资源；尚未打开浏览器时为空操作。"""
