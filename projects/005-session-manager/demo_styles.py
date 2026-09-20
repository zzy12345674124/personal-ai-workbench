"""ttkbootstrap vs customtkinter 左右对比预览（设计阶段的临时 demo，非正式产品）。

运行：python demo_styles.py
依赖：pip install ttkbootstrap customtkinter
"""
import sys
from datetime import datetime, timedelta

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# 假数据，与最终产品无关
MOCK_ROWS = [
    ("2026-08-02 10:44", "project_002 VPS", "1172KB", "来了"),
    ("2026-07-30 11:00", "project_002 VPS", "957KB", "我新买了个节点…"),
    ("2026-07-29 17:13", "Desktop", "204KB", "hello"),
    ("2026-07-28 14:35", "project_002 VPS", "65KB", "hello"),
    ("2026-07-28 12:34", "Home", "268KB", "请分 20 段介绍 HTTP 代理…"),
]


def demo_ttkbootstrap():
    import ttkbootstrap as tb
    from ttkbootstrap.constants import DANGER, PRIMARY, SUCCESS

    win = tb.Window(themename="flatly", title="ttkbootstrap 预览（flatly 主题）", size=(560, 360))
    win.place_window_center()
    header = tb.Label(win, text="会话管家 — ttkbootstrap", font=("Microsoft YaHei UI", 14, "bold"))
    header.pack(pady=(12, 4))
    tb.Label(win, text="浅色 flatly 主题 · 统计概览：共 5 会话 / 2.6MB / 回收站 1", bootstyle="secondary").pack()

    tree = tb.Treeview(win, columns=("time", "proj", "size", "prev"), show="headings", height=5, bootstyle="primary")
    for col, txt, w in (("time", "时间", 110), ("proj", "项目", 130), ("size", "大小", 60), ("prev", "首条消息", 200)):
        tree.heading(col, text=txt)
        tree.column(col, width=w, anchor="w")
    for row in MOCK_ROWS:
        tree.insert("", "end", values=row)
    tree.pack(fill="both", expand=True, padx=16, pady=8)

    bar = tb.Frame(win)
    bar.pack(pady=(0, 14))
    tb.Button(bar, text="进入", bootstyle=SUCCESS).pack(side="left", padx=4)
    tb.Button(bar, text="删除到回收站", bootstyle=DANGER).pack(side="left", padx=4)
    tb.Button(bar, text="恢复", bootstyle="secondary").pack(side="left", padx=4)
    tb.Button(bar, text="清空回收站", bootstyle="warning-outline").pack(side="left", padx=4)
    return win


def demo_customtkinter():
    import customtkinter as ctk

    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")
    win = ctk.CTk()
    win.title("customtkinter 预览（深色圆角）")
    win.geometry("560x360")
    win.grid_columnconfigure(0, weight=1)

    ctk.CTkLabel(win, text="会话管家 — customtkinter", font=("Microsoft YaHei UI", 15, "bold")).grid(row=0, pady=(14, 2))
    ctk.CTkLabel(win, text="深色主题 · 统计概览：共 5 会话 / 2.6MB / 回收站 1", text_color="gray70").grid(row=1)

    # 用 Text 模拟表格（demo 够用）
    txt = ctk.CTkTextbox(win, height=170, font=("Microsoft YaHei UI", 11))
    txt.grid(row=2, padx=16, pady=8, sticky="nsew")
    txt.insert("1.0", "时间\t项目\t大小\t首条消息\n" + "\n".join("\t".join(r) for r in MOCK_ROWS))
    txt.configure(state="disabled")

    bar = ctk.CTkFrame(win, fg_color="transparent")
    bar.grid(row=3, pady=(0, 14))
    ctk.CTkButton(bar, text="进入", width=110, fg_color="#2fa572").pack(side="left", padx=4)
    ctk.CTkButton(bar, text="删除到回收站", width=110, fg_color="#d64545").pack(side="left", padx=4)
    ctk.CTkButton(bar, text="恢复", width=80).pack(side="left", padx=4)
    ctk.CTkButton(bar, text="清空回收站", width=110, fg_color="transparent", border_width=1).pack(side="left", padx=4)
    return win


if __name__ == "__main__":
    w1 = demo_ttkbootstrap()
    w2 = demo_customtkinter()
    # mainloop 只调用一次（Tk 事件循环驱动所有窗口），两个窗口并排摆放
    w1.geometry("+40+80")
    w2.geometry("+660+80")
    w2.mainloop()
