# 会话管家

会话管家是一个本地 Windows 桌面应用，用于浏览、搜索、整理和恢复 Claude Code 历史会话。应用采用 Python + pywebview，前端为本地 HTML/CSS/JavaScript，可离线运行。

## 最短使用路径

1. 双击 `dist/会话管家.exe`。
2. 如果资源管理器仍显示旧图标，使用 `dist/会话管家-Windows11.exe`。
3. 在应用中从“会话”或“项目”页面浏览历史记录，并通过“进入”恢复对应会话。
4. “项目”页面：拖动手柄调整项目顺序；把展开卡片里的会话拖到其他项目卡片，可将该会话移入那个项目。

## 主要目录

- `app.py`：pywebview 窗口和 Python/JavaScript API 桥接。
- `sessions_core.py`：会话扫描、解析、搜索、统计、回收站和项目过滤逻辑。
- `session_manager.py`：命令行薄壳。
- `web/`：Windows 11 风格界面及交互。
- `assets/`：应用图标与图标生成器。
- `tests/`：pytest 自动化测试。
- `docs/`：设计、实施计划和跨工具交接文档。
- `dist/`：可直接运行的 EXE 交付物。

## 开发与验证

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe app.py
```

打包使用：

```powershell
.\build.bat
```

自动化测试只能使用临时数据，不得操作真实会话、项目列表或回收站。GUI 验证由用户手动完成。

## 文档入口

- `项目日志.md`：当前状态、架构约束以及 Claude/Codex 的改动记录。
- `docs/2026-08-03-session-manager-gui-design.md`：GUI v1 设计。
- `docs/2026-08-03-session-manager-gui-plan.md`：实施计划与自审记录。
- `docs/2026-08-03-会话管家-交接文档-Codex-UI美化.md`：Codex UI 美化前的功能基线。

