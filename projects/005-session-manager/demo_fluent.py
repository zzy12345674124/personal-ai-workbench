"""Fluent 风格 demo：Windows 设置质感的「会话管家」界面预览（设计阶段用）。

运行：python demo_fluent.py
依赖：pip install pywebview（Windows 11 自带 WebView2 运行时）
"""
import sys

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import webview

HTML_PATH = r"D:/Count/Obsidian/main/project_005_会话管家/demo_fluent.html"

webview.create_window(
    "会话管家 — Fluent 预览",
    HTML_PATH,
    width=960,
    height=640,
    min_size=(720, 480),
)
webview.start()
