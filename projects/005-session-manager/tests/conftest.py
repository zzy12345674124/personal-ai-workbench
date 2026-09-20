import json
from datetime import datetime, timezone
import pytest

@pytest.fixture
def fixture_projects_dir(tmp_path):
    return tmp_path / "projects"

@pytest.fixture
def fixture_trash_dir(tmp_path):
    return tmp_path / "trash"

@pytest.fixture
def make_session_file():
    """工厂 fixture：写入一个符合 Claude Code 转录格式的会话文件，返回路径。"""
    def _make(projects_dir, slug, uuid, ts_iso, user_text):
        from pathlib import Path
        p = Path(projects_dir) / slug / f"{uuid}.jsonl"
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "user", "timestamp": ts_iso,
                                "message": {"role": "user", "content": user_text}}, ensure_ascii=False) + "\n")
            f.write(json.dumps({"type": "assistant", "timestamp": ts_iso,
                                "message": {"role": "assistant", "content": "ok"}}) + "\n")
        return p
    return _make

@pytest.fixture
def sample_sessions(fixture_projects_dir, make_session_file):
    """两个项目共 3 个会话，时间错开。"""
    make_session_file(fixture_projects_dir, "D--Count-Obsidian-main-project-002-----VPS", "aaa111",
                      "2026-08-01T10:00:00+00:00", "来了")
    make_session_file(fixture_projects_dir, "D--Count-Obsidian-main-project-002-----VPS", "bbb222",
                      "2026-07-30T09:00:00+00:00", "我新买了个节点，按教程走一遍")
    make_session_file(fixture_projects_dir, "C--Users-20714", "ccc333",
                      "2026-07-28T08:00:00+00:00", "hello")
    return fixture_projects_dir
