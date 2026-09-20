"""B站 CloakBrowser 人工登录：只检测 isLogin 布尔值，不读取账号资料。"""

from __future__ import annotations

import argparse
import ctypes
import os
import sys
import time
from pathlib import Path
from typing import Any


def nav_is_logged_in(payload: Any) -> bool:
    data = payload.get("data") if isinstance(payload, dict) else None
    return data.get("isLogin") is True if isinstance(data, dict) else False


def run(profile: Path, timeout_seconds: int) -> int:
    if os.name == "nt" and not os.environ.get("PROCESSOR_ARCHITECTURE"):
        os.environ["PROCESSOR_ARCHITECTURE"] = "AMD64" if sys.maxsize > 2**32 else "x86"
    from cloakbrowser import launch_persistent_context

    profile.mkdir(parents=True, exist_ok=True)
    with launch_persistent_context(str(profile), headless=False) as context:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://www.bilibili.com/", wait_until="domcontentloaded", timeout=60_000)
        if os.name == "nt":
            ctypes.windll.user32.MessageBoxW(
                0,
                "请在已打开的 CloakBrowser 中登录 B站。\n登录完成后脚本会自动检测并关闭窗口。",
                "会话管家 - B站登录",
                0x40,
            )
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            try:
                payload = page.evaluate(
                    "async () => { const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {credentials: 'include'}); return await r.json(); }"
                )
                if nav_is_logged_in(payload):
                    print("BILIBILI_LOGIN_OK", flush=True)
                    page.wait_for_timeout(1_000)
                    return 0
            except Exception:
                pass
            page.wait_for_timeout(3_000)
    print("BILIBILI_LOGIN_TIMEOUT", flush=True)
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--profile", default=str(Path.home() / ".cloakbrowser" / "profiles" / "bilibili")
    )
    parser.add_argument("--timeout-seconds", type=int, default=900)
    args = parser.parse_args(argv)
    if not 60 <= args.timeout_seconds <= 1_800:
        parser.error("timeout-seconds 必须在 60–1800 之间")
    return run(Path(args.profile).resolve(), args.timeout_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
