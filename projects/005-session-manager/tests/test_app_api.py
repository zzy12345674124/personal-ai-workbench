import json
from pathlib import Path
import pytest
from app import AppApi, _munge_path, resolve_project_dir

@pytest.fixture(autouse=True)
def _no_real_powershell(monkeypatch):
    """所有 enter 测试默认不调用真实 powershell（进程扫描直接返回空）。

    各测试可自行 monkeypatch subprocess.check_output（解析/异常测试）或
    app.session_live_pids（占用检测测试）覆盖本 fixture 的默认值。
    """
    monkeypatch.setattr("subprocess.check_output", lambda *a, **kw: "")

def test_api_roundtrip(sample_sessions, fixture_trash_dir, tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    api = AppApi(projects_dir=sample_sessions, trash_dir=fixture_trash_dir, settings_path=settings,
                 codex_sessions_dir=tmp_path / "codex", codex_archived_dir=tmp_path / "codex-archive")
    groups = api.list_sessions()
    assert len(groups) == 2 and groups[0]["count"] == 2
    assert api.search("节点")[0]["sessions"][0]["preview"].startswith("我新买")
    assert api.stats()["total"] == 3
    sid = groups[0]["sessions"][0]["id"]
    assert api.delete([sid])[sid] == "已移入回收站"
    assert api.restore([sid])["restored"] == 1

def test_api_rename_session_roundtrip(sample_sessions, fixture_trash_dir, tmp_path):
    settings = tmp_path / "settings.json"
    api = AppApi(projects_dir=sample_sessions, trash_dir=fixture_trash_dir, settings_path=settings,
                 codex_sessions_dir=tmp_path / "codex", codex_archived_dir=tmp_path / "codex-archive")
    sid = api.list_sessions()[0]["sessions"][0]["id"]
    assert api.rename_session(sid, "API改名") == {"ok": True, "title": "API改名"}
    s = api.list_sessions()[0]["sessions"][0]
    assert s["id"] == sid and s["title"] == "API改名"
    assert api.search("API改")[0]["sessions"][0]["id"] == sid   # 标题参与搜索
    assert api.rename_session(sid, "   ") == {"ok": False, "error": "标题为空，未修改"}

def test_api_cross_tool_search_serializes_codex_as_readonly(tmp_path):
    codex_root = tmp_path / "codex" / "sessions" / "2026" / "08" / "24"
    codex_root.mkdir(parents=True)
    sid = "33333333-3333-3333-3333-333333333333"
    rows = [
        {"timestamp": "2026-08-24T10:00:00Z", "type": "session_meta",
         "payload": {"id": sid, "cwd": str(tmp_path / "project_gamma")}},
        {"timestamp": "2026-08-24T10:00:01Z", "type": "event_msg",
         "payload": {"type": "user_message", "message": "序列化虚构命中"}},
    ]
    (codex_root / f"rollout-{sid}.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    api = AppApi(projects_dir=tmp_path / "claude", settings_path=tmp_path / "settings.json",
                 codex_sessions_dir=tmp_path / "codex" / "sessions",
                 codex_archived_dir=tmp_path / "codex" / "archived")
    result = api.search("虚构命中")
    session = result[0]["sessions"][0]
    assert session["source_tool"] == "codex" and session["readonly"] is True
    assert session["source"] == str(tmp_path / "project_gamma")

def test_api_settings_roundtrip(tmp_path):
    settings = tmp_path / "settings.json"
    api = AppApi(settings_path=settings)
    api.set_settings({"dark": True, "confirm_delete": False, "claude_path": ""})
    assert api.get_settings()["dark"] is True and api.get_settings()["confirm_delete"] is False

def test_api_get_settings_non_dict_shapes(tmp_path):
    """设置文件是合法 JSON 但非 dict（数组/字符串）：回退默认值，不抛 TypeError。"""
    default = {"dark": False, "confirm_delete": True, "claude_path": "", "close_after_enter": False}
    for content in ("[1, 2]", '"字符串"'):
        settings = tmp_path / "settings.json"
        settings.write_text(content, encoding="utf-8")
        api = AppApi(settings_path=settings)
        assert api.get_settings() == default

def test_api_enter_missing_claude(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: None)
    api = AppApi(settings_path=tmp_path / "s.json")
    assert api.enter("abc") == {"ok": False, "error": "未找到 claude，请在设置中配置路径"}

def test_api_enter_spawns(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    project = tmp_path / "project"
    project.mkdir()
    sid = "abc123"
    projects_dir = tmp_path / "projects"
    session_file = projects_dir / _munge_path(project) / f"{sid}.jsonl"
    session_file.parent.mkdir(parents=True)
    session_file.write_text(json.dumps({"cwd": str(project)}) + "\n", encoding="utf-8")
    calls = []
    import subprocess
    def fake_popen(cmd, **kw):
        calls.append((cmd, kw.get("creationflags")))
        return None
    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    api = AppApi(projects_dir=projects_dir, settings_path=tmp_path / "s.json")
    assert api.enter(sid)["ok"] is True
    assert calls[0][0] == ["C:/fake/claude.exe", "--resume", sid]
    assert calls[0][1] == subprocess.CREATE_NEW_CONSOLE

def test_api_enter_sanitizes_child_session_env(tmp_path, monkeypatch):
    """Popen 的 env 必须移除继承的 CLAUDE_CODE_CHILD_SESSION 标记并强制保存转录。"""
    import os, subprocess
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    monkeypatch.setenv("CLAUDE_CODE_CHILD_SESSION", "1")
    monkeypatch.setenv("SOME_OTHER_VAR", "keep-me")
    project = tmp_path / "project"
    project.mkdir()
    sid = "abc123"
    projects_dir = tmp_path / "projects"
    session_file = projects_dir / _munge_path(project) / f"{sid}.jsonl"
    session_file.parent.mkdir(parents=True)
    session_file.write_text(json.dumps({"cwd": str(project)}) + "\n", encoding="utf-8")
    calls = []
    monkeypatch.setattr(subprocess, "Popen",
                        lambda cmd, **kw: calls.append(kw.get("env")) or None)
    api = AppApi(projects_dir=projects_dir, settings_path=tmp_path / "s.json")
    assert api.enter(sid)["ok"] is True
    env = calls[0]
    assert env is not None
    assert "CLAUDE_CODE_CHILD_SESSION" not in env
    assert env.get("CLAUDE_CODE_FORCE_SESSION_PERSISTENCE") == "1"
    assert env.get("SOME_OTHER_VAR") == "keep-me"
    # env 是副本：enter 不得污染父进程环境
    assert os.environ.get("CLAUDE_CODE_CHILD_SESSION") == "1"

# ---- slug → 真实项目目录解析 ----

def test_munge_path_known_examples():
    """已实测的 4 个真实样例的 munge 形式。"""
    assert _munge_path(Path(r"D:\Workspace\project-demo")) == "D--Workspace-project-demo"
    assert _munge_path(Path(r"C:\Home\example")) == "C--Home-example"
    assert _munge_path(Path(r"C:\Home\example\Desktop")) == "C--Home-example-Desktop"

def test_resolve_project_dir_exact_match(tmp_path):
    root = tmp_path / "项目X"
    root.mkdir()
    assert resolve_project_dir(_munge_path(root), [root]) == root

def test_resolve_project_dir_nested_exact_match(tmp_path):
    """递归扫描：嵌套目录（如 Desktop\\专报）的真实 slug 精确命中，且不误解析到父目录。"""
    root = tmp_path / "Desktop"
    nested = root / "专报"
    nested.mkdir(parents=True)
    slug = _munge_path(nested)   # 含多出连字符尾缀的完整 slug（验收问题 C--Users-20714-Desktop--- 的同构复现）
    assert slug.endswith("--")
    assert resolve_project_dir(slug, [root]) == nested
    assert resolve_project_dir(slug, [root]) != root

def test_resolve_project_dir_no_rstrip_fallback(tmp_path):
    """rstrip 兜底已废弃：无精确命中时尾部连字符不再套用到父目录，返回 None。"""
    root = tmp_path / "Desktop"
    root.mkdir()
    slug = _munge_path(root) + "---"
    assert resolve_project_dir(slug, [root]) is None

def test_resolve_project_dir_no_match(tmp_path):
    root = tmp_path / "项目X"
    root.mkdir()
    assert resolve_project_dir("C--Users-20714-Desktop", [root]) is None
    assert resolve_project_dir("C--Users-20714-Desktop---", [root]) is None

def test_resolve_project_dir_ai_workspace_temp_not_pruned(tmp_path):
    """验收回归：AI工作区\\temp 是合法工作目录，跳过列表不得剪枝它（否则会话点
    「进入」报 No conversation found）。"""
    root = tmp_path / "Desktop"          # 候选根（对应 vault main 的角色）
    target = root / "AI工作区" / "temp"
    target.mkdir(parents=True)
    slug = _munge_path(target)           # D--Count-Obsidian-main-AI----temp 的同构复现
    assert slug.endswith("--temp")
    assert resolve_project_dir(slug, [root]) == target

def test_resolve_cache_isolated_by_roots(tmp_path):
    """缓存键必须含 roots：同 slug 在不同候选根下的解析结果互不串扰
    （生产上目录先不存在后创建、或先存在后删除，都不得走旧缓存）。"""
    real = tmp_path / "real"
    real.mkdir()
    slug = _munge_path(real)
    # 先 miss 后 hit：roots 不含该路径 → None；含该路径 → 命中（旧缓存按 slug 键会永久 None）
    assert resolve_project_dir(slug, [tmp_path / "nope"]) is None
    assert resolve_project_dir(slug, [tmp_path]) == real
    # 先 hit 后 miss：缓存命中后换 roots 仍须重新解析为 None
    assert resolve_project_dir(slug, [tmp_path]) == real
    assert resolve_project_dir(slug, [tmp_path / "nope"]) is None

def test_resolve_project_dir_common_names_not_pruned(tmp_path):
    """temp/Temp/build/dist 曾误入跳过列表：作为普通目录名必须能精确命中。
    （Windows 文件系统大小写不敏感，temp 与 Temp 是同一目录，故每个名字用独立
    父根互不干扰。）"""
    for i, name in enumerate(("temp", "Temp", "build", "dist")):
        root = tmp_path / f"Desktop-{i}"
        target = root / "AI工作区" / name
        target.mkdir(parents=True)
        slug = _munge_path(target)
        assert resolve_project_dir(slug, [root]) == target

# ---- enter 的 cwd 作用域 ----

def test_enter_cwd_resolved_project_dir(tmp_path, monkeypatch):
    """会话 slug 能解析到真实项目目录时，Popen 的 cwd 必须是该目录。"""
    root = tmp_path / "项目X"
    root.mkdir()
    slug = _munge_path(root)
    sid = "aaa111"
    f = tmp_path / "projects" / slug / f"{sid}.jsonl"
    f.parent.mkdir(parents=True)
    f.write_text("", encoding="utf-8")
    api = AppApi(projects_dir=f.parent.parent, settings_path=tmp_path / "s.json")
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    calls = []
    import subprocess
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)) or None)
    assert api.enter(sid, roots=[root])["ok"] is True
    assert calls[0][1]["cwd"] == str(root)
    assert calls[0][0] == ["C:/fake/claude.exe", "--resume", sid]

def test_enter_prefers_recorded_cwd_outside_scan_roots(tmp_path, monkeypatch):
    """JSONL 的精确 cwd 存在时，即使不在扫描根中也必须直接使用。"""
    root = tmp_path / "项目X"
    root.mkdir()
    sid = "bbb222"
    f = tmp_path / "projects" / _munge_path(root) / f"{sid}.jsonl"
    f.parent.mkdir(parents=True)
    f.write_text(json.dumps({"cwd": str(root)}, ensure_ascii=False) + "\n", encoding="utf-8")
    api = AppApi(projects_dir=f.parent.parent, settings_path=tmp_path / "s.json")
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    calls = []
    import subprocess
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)) or None)
    assert api.enter(sid, roots=[tmp_path / "其他"])["ok"] is True
    assert calls[0][1]["cwd"] == str(root)

def test_enter_missing_recorded_cwd_stops_before_spawn(tmp_path, monkeypatch):
    """原目录已删除时返回结构化错误，不得从 home 错误启动 Claude。"""
    missing = tmp_path / "已删除项目"
    sid = "missing123"
    projects_dir = tmp_path / "projects"
    f = projects_dir / _munge_path(missing) / f"{sid}.jsonl"
    f.parent.mkdir(parents=True)
    f.write_text(json.dumps({"cwd": str(missing)}, ensure_ascii=False) + "\n", encoding="utf-8")
    api = AppApi(projects_dir=projects_dir, settings_path=tmp_path / "s.json")
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    calls = []
    monkeypatch.setattr("subprocess.Popen", lambda *args, **kwargs: calls.append((args, kwargs)))

    result = api.enter(sid, roots=[tmp_path / "其他"])

    assert result["ok"] is False
    assert result["code"] == "project_dir_missing"
    assert result["missing_path"] == str(missing)
    assert calls == []

def test_recover_missing_project_creates_empty_dir_and_enters(tmp_path, monkeypatch):
    """确认恢复后只重建 JSONL 中的原目录，并从该目录启动同一会话。"""
    missing = tmp_path / "已删除项目"
    sid = "recover123"
    projects_dir = tmp_path / "projects"
    f = projects_dir / _munge_path(missing) / f"{sid}.jsonl"
    f.parent.mkdir(parents=True)
    f.write_text(json.dumps({"cwd": str(missing)}, ensure_ascii=False) + "\n", encoding="utf-8")
    api = AppApi(projects_dir=projects_dir, settings_path=tmp_path / "s.json")
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    calls = []
    monkeypatch.setattr("subprocess.Popen", lambda cmd, **kw: calls.append((cmd, kw)) or None)

    result = api.recover_missing_project(sid)

    assert result == {"ok": True, "error": None, "created_path": str(missing)}
    assert missing.is_dir()
    assert calls[0][0] == ["C:/fake/claude.exe", "--resume", sid]
    assert calls[0][1]["cwd"] == str(missing)

# ---- 组内来源标注（source） ----

def test_source_merged_group_relpath(tmp_path, monkeypatch):
    """合并组（friendly 相同的多个 slug）：组根 = 最短 slug 的解析路径，
    source = 会话真实路径相对组根的相对部分（Windows 分隔符），组根自身为 ""。
    tmp 下以 C:\\Users-20714（根）与 Desktop\\专报（子目录）的同构结构模拟。"""
    import sessions_core as core
    home = tmp_path / "home"                      # 对应示例用户目录
    nested = home / "Desktop" / "专报"
    nested.mkdir(parents=True)
    home_slug = _munge_path(home)
    nested_slug = _munge_path(nested)
    assert nested_slug.startswith(home_slug)
    # 模拟真实场景：C--Users-20714* 前缀的 slug 都显示为 Home（合并键）
    monkeypatch.setattr(core, "friendly_name",
                        lambda slug: "Home" if slug.startswith(home_slug) else slug)
    projects = tmp_path / "projects"
    p1 = projects / home_slug / "r1.jsonl"
    p1.parent.mkdir(parents=True)
    p1.write_text('{"type": "user", "timestamp": "2026-08-01T10:00:00+00:00", '
                  '"message": {"role": "user", "content": "根会话"}}\n', encoding="utf-8")
    p2 = projects / nested_slug / "r2.jsonl"
    p2.parent.mkdir(parents=True)
    p2.write_text('{"type": "user", "timestamp": "2026-08-01T11:00:00+00:00", '
                  '"message": {"role": "user", "content": "子目录会话"}}\n', encoding="utf-8")
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path])
    groups = api.list_sessions()
    assert len(groups) == 1 and groups[0]["friendly"] == "Home"   # 合并为一组
    assert groups[0]["count"] == 2
    by_id = {s["id"]: s for s in groups[0]["sessions"]}
    assert by_id["r1"]["source"] == ""            # 会话就是组根本身
    assert by_id["r2"]["source"] == "Desktop\\专报"

def test_source_single_slug_group_all_empty(tmp_path, make_session_file):
    """仅单一 slug 的非合并组：source 全为空（前端不渲染）。"""
    projects = tmp_path / "projects"
    make_session_file(projects, "D--Count-Obsidian-main-project-002-----VPS", "c1",
                      "2026-08-01T10:00:00+00:00", "甲")
    make_session_file(projects, "D--Count-Obsidian-main-project-002-----VPS", "c2",
                      "2026-08-01T09:00:00+00:00", "乙")
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path])
    groups = api.list_sessions()
    assert len(groups) == 1
    assert all(s["source"] == "" for s in groups[0]["sessions"])

def test_group_root_slug_follows_resolved_hit(tmp_path, monkeypatch):
    """组根 slug 跟随实际命中解析的 slug：最短 slug 解析失败、更长 slug 命中时，
    兜底去前缀以命中 slug 为基准（旧实现固定用最短 slug，会丢前缀匹配）。"""
    import sessions_core as core
    nested = tmp_path / "home" / "Desktop" / "专报"
    nested.mkdir(parents=True)
    short_slug = _munge_path(tmp_path / "x")                  # 不存在 → 解析失败
    long_slug = _munge_path(nested)                           # 命中 → 组根
    extra_slug = long_slug + "-Extra---"                      # 解析失败，但以 long_slug 为前缀
    assert len(short_slug) < len(long_slug)
    monkeypatch.setattr(core, "friendly_name", lambda slug: "Home")
    projects = tmp_path / "projects"
    for slug, sid in ((short_slug, "g1"), (long_slug, "g2"), (extra_slug, "g3")):
        d = projects / slug
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{sid}.jsonl").write_text('{"type": "user", "timestamp": "2026-08-01T10:00:00+00:00", '
                                        '"message": {"role": "user", "content": "x"}}\n', encoding="utf-8")
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path])
    groups = api.list_sessions()
    assert len(groups) == 1
    by_id = {s["id"]: s for s in groups[0]["sessions"]}
    assert by_id["g2"]["source"] == ""            # 命中的根 slug 会话 = 组根本身
    assert by_id["g3"]["source"] == "Extra---"    # 兜底以命中 slug 为前缀基准（旧实现为 ""）

def test_source_fallback_when_resolve_fails(tmp_path):
    """解析失败兜底：source 用 slug 去掉组根 slug 前缀后的片段（如 Desktop---）。"""
    projects = tmp_path / "projects"
    for slug, sid in (("C--Users-20714", "f1"), ("C--Users-20714-Desktop---", "f2")):
        d = projects / slug
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{sid}.jsonl").write_text('{"type": "user", "timestamp": "2026-08-01T10:00:00+00:00", '
                                        '"message": {"role": "user", "content": "x"}}\n', encoding="utf-8")
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path / "不存在"])
    groups = api.list_sessions()
    assert len(groups) == 1 and groups[0]["friendly"] == "Home"   # 真实 friendly：两 slug 合并
    by_id = {s["id"]: s for s in groups[0]["sessions"]}
    assert by_id["f1"]["source"] == ""            # 组根本身（根 slug 自身）→ ""
    assert by_id["f2"]["source"] == "Desktop---"  # 去根 slug 前缀兜底

# ---- 项目（Codex 式）----

def test_projects_roundtrip(tmp_path):
    """list → add → 出现（含 count）→ remove → 消失。"""
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=pfile)
    assert api.list_projects() == []
    assert api.add_project("测试项目", str(tmp_path)) == {"ok": True, "error": None}
    assert api.list_projects() == [{"name": "测试项目", "path": str(tmp_path), "count": 0}]
    assert api.remove_project(str(tmp_path)) == {"ok": True}
    assert api.list_projects() == []
    assert not pfile.exists() or pfile.read_text(encoding="utf-8") == "[]"   # 文件未被残留

def test_projects_missing_or_corrupt_file(tmp_path):
    """缺失 / 非法 JSON / 非 list / 畸形项：一律返回 [] 或剔除畸形项。"""
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=pfile)
    assert api.list_projects() == []                 # 缺失
    pfile.write_text("{broken", encoding="utf-8")
    assert api.list_projects() == []                 # 损坏
    pfile.write_text('{"not": "a list"}', encoding="utf-8")
    assert api.list_projects() == []                 # 合法 JSON 但非 list
    pfile.write_text('[{"name": "甲", "path": "C:\\\\x"}, {"bad": 1}, {"name": "  "}]',
                     encoding="utf-8")
    assert api.list_projects() == [{"name": "甲", "path": "C:\\x", "count": 0}]   # 畸形项剔除

def test_projects_invalid_utf8_file(tmp_path):
    """含无效 UTF-8 字节的文件：read_text 抛 UnicodeDecodeError，必须回退 [] 而
    不得穿透 js_api 桥接线程（否则前端 refreshAll 的 Promise.all 拒绝、初始化
    链中断）。"""
    pfile = tmp_path / "projects.json"
    pfile.write_bytes(b'\xff\xfe\x00{"name": "x"}')   # \xff 非合法 UTF-8 起始字节
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=pfile)
    assert api.list_projects() == []

def test_add_project_path_is_file_rejected(tmp_path):
    """路径是文件（非目录）：add 与 start_project_session 均按不存在处理。"""
    f = tmp_path / "文件.txt"
    f.write_text("x", encoding="utf-8")
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    assert api.add_project("测试", str(f))["error"] == "路径不存在或不是文件夹"
    assert api.start_project_session(str(f))["error"] == "项目路径不存在或不是文件夹"

def test_add_project_validation(tmp_path):
    """空名 / 超长名 / 路径不存在 / 重复 name / 重复 path（含路径归一化）。"""
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=pfile)
    d = tmp_path / "存在"
    d.mkdir()
    assert api.add_project("  ", str(d))["error"] == "名称不能为空"
    assert api.add_project("x" * 51, str(d))["error"] == "名称不能超过 50 个字符"
    assert api.add_project("边界50", str(tmp_path / "不存在"))["error"] == "路径不存在或不是文件夹"
    assert api.add_project("测试", str(d)) == {"ok": True, "error": None}
    assert api.add_project("测试", str(d))["error"] == "已存在同名项目"
    assert api.add_project("测试2", str(d))["error"] == "该项目路径已添加"
    # 归一化路径（大小写/.. 展开）同样判重
    assert api.add_project("测试2", str(d.parent / "存在" / ".." / "存在"))["error"] == "该项目路径已添加"

def test_rename_project_updates_name_only(tmp_path, make_session_file):
    """重命名成功：名称更新、其他项目不动、count 与展开源数据不受影响、原子写不留 tmp。"""
    d1 = tmp_path / "一"
    d2 = tmp_path / "二"
    d1.mkdir()
    d2.mkdir()
    projects = tmp_path / "projects"
    make_session_file(projects, _munge_path(d1), "r1", "2026-08-01T10:00:00+00:00", "会话")
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path], projects_path=pfile)
    api.add_project("项目甲", str(d1))
    api.add_project("项目乙", str(d2))
    assert api.rename_project(str(d1), "项目甲改名") == {"ok": True, "error": None}
    by_path = {p["path"]: p for p in api.list_projects()}
    assert by_path[str(d1)]["name"] == "项目甲改名"
    assert by_path[str(d1)]["count"] == 1                  # 重命名不碰会话归属与计数
    assert by_path[str(d2)]["name"] == "项目乙"            # 其他项目不动
    # 原子写：不留 .tmp 残留；文件只含 name/path（count 是读取时计算的瞬时字段）
    assert not pfile.with_name("projects.json.tmp").exists()
    saved = json.loads(pfile.read_text(encoding="utf-8"))
    assert saved == [{"name": "项目甲改名", "path": str(d1)}, {"name": "项目乙", "path": str(d2)}]
    # 路径归一化匹配：大小写不同的同一路径同样命中
    assert api.rename_project(str(d1).upper(), "甲") == {"ok": True, "error": None}
    assert api.list_projects()[0]["name"] == "甲"

def test_rename_project_validation(tmp_path):
    """空名 / 超长名 / 与另一项目重名 / path 不存在 → 明确错误且列表不变。"""
    d1 = tmp_path / "一"
    d2 = tmp_path / "二"
    d1.mkdir()
    d2.mkdir()
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=pfile)
    api.add_project("项目甲", str(d1))
    api.add_project("项目乙", str(d2))
    assert api.rename_project(str(d1), "   ")["error"] == "名称不能为空"
    assert api.rename_project(str(d1), "x" * 51)["error"] == "名称不能超过 50 个字符"
    assert api.rename_project(str(d1), "项目乙")["error"] == "已存在同名项目"
    assert api.rename_project(str(tmp_path / "不存在"), "新名")["error"] == "项目不存在"
    assert api.rename_project("", "新名")["error"] == "项目不存在"
    names = [p["name"] for p in api.list_projects()]
    assert names == ["项目甲", "项目乙"]                     # 全部拒绝，列表原样
    # 重命名为当前名（未变）→ 成功（幂等无副作用）
    assert api.rename_project(str(d1), "项目甲") == {"ok": True, "error": None}
    assert api.list_projects()[0]["name"] == "项目甲"

def test_rename_project_missing_or_corrupt_file(tmp_path):
    """项目文件缺失/损坏：按「项目不存在」报错，不抛异常。"""
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=pfile)
    assert api.rename_project("C:/任意", "新名")["error"] == "项目不存在"
    pfile.write_text("{broken", encoding="utf-8")
    assert api.rename_project("C:/任意", "新名")["error"] == "项目不存在"

# ---- 项目页展开：project_sessions / list_projects count ----

def test_project_sessions_root_and_subfolder(tmp_path, make_session_file):
    """项目根 slug 的会话 + 项目子文件夹 slug 的会话都命中；项目外会话不命中；
    解析失败 slug 排除；source = 相对项目文件夹路径（根→""、子→"sub"）。"""
    proj = tmp_path / "proj"
    sub = proj / "sub"
    sub.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    projects = tmp_path / "projects"
    make_session_file(projects, _munge_path(proj), "r1", "2026-08-01T10:00:00+00:00", "根会话")
    make_session_file(projects, _munge_path(sub), "r2", "2026-08-01T11:00:00+00:00", "子会话")
    make_session_file(projects, _munge_path(outside), "r3", "2026-08-01T09:00:00+00:00", "外部会话")
    make_session_file(projects, "D--Count-Obsidian-main-X--no-such-dir", "r4",
                      "2026-08-01T08:00:00+00:00", "解析失败")
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path])
    out = api.project_sessions(str(proj))
    assert [s["id"] for s in out] == ["r2", "r1"]          # 时间倒序
    by_id = {s["id"]: s for s in out}
    assert by_id["r1"]["source"] == ""
    assert by_id["r2"]["source"] == "sub"
    assert "r3" not in by_id and "r4" not in by_id

def test_project_sessions_case_insensitive_windows_path(tmp_path, make_session_file):
    """Windows 路径大小写不一致（normcase 归一化）：注册路径大写仍命中。"""
    proj = tmp_path / "ProjCase"
    proj.mkdir()
    projects = tmp_path / "projects"
    make_session_file(projects, _munge_path(proj), "c1", "2026-08-01T10:00:00+00:00", "x")
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path])
    assert len(api.project_sessions(str(proj))) == 1
    assert len(api.project_sessions(str(proj).upper())) == 1   # 大小写不同仍命中

def test_project_sessions_empty_project(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path])
    assert api.project_sessions(str(proj)) == []

def test_list_projects_count(tmp_path, make_session_file):
    """list_projects 的 count：项目根+子文件夹会话计入，项目外/解析失败不计。"""
    proj = tmp_path / "proj"
    sub = proj / "sub"
    sub.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    projects = tmp_path / "projects"
    make_session_file(projects, _munge_path(proj), "r1", "2026-08-01T10:00:00+00:00", "a")
    make_session_file(projects, _munge_path(sub), "r2", "2026-08-01T11:00:00+00:00", "b")
    make_session_file(projects, _munge_path(outside), "r3", "2026-08-01T09:00:00+00:00", "c")
    make_session_file(projects, "D--Count-Obsidian-main", "r4", "2026-08-01T08:00:00+00:00", "d")
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path],
                 projects_path=pfile)
    api.add_project("我的项目", str(proj))
    api.add_project("外部", str(outside))
    by_name = {p["name"]: p for p in api.list_projects()}
    assert by_name["我的项目"]["count"] == 2
    assert by_name["外部"]["count"] == 1

def test_start_project_session_spawns(tmp_path, monkeypatch):
    """Popen 断言：无参数 claude（全新会话）、cwd=项目路径、CREATE_NEW_CONSOLE、env 净化。"""
    import os, subprocess
    d = tmp_path / "项目"
    d.mkdir()
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    monkeypatch.setenv("CLAUDE_CODE_CHILD_SESSION", "1")
    monkeypatch.setenv("SOME_OTHER_VAR", "keep-me")
    calls = []
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)) or None)
    api = AppApi(settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    assert api.start_project_session(str(d)) == {"ok": True, "error": None}
    cmd, kw = calls[0]
    assert cmd == ["C:/fake/claude.exe"]                       # 不带参数 = 新会话
    assert kw["cwd"] == str(d)
    assert kw["creationflags"] == subprocess.CREATE_NEW_CONSOLE
    assert "CLAUDE_CODE_CHILD_SESSION" not in kw["env"]
    assert kw["env"]["CLAUDE_CODE_FORCE_SESSION_PERSISTENCE"] == "1"
    assert kw["env"].get("SOME_OTHER_VAR") == "keep-me"
    assert os.environ.get("CLAUDE_CODE_CHILD_SESSION") == "1"  # 不污染父进程环境

def test_start_project_session_errors(tmp_path, monkeypatch):
    d = tmp_path / "项目"
    d.mkdir()
    api = AppApi(settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    assert api.start_project_session(str(tmp_path / "不存在"))["error"] == "项目路径不存在或不是文件夹"
    monkeypatch.setattr("shutil.which", lambda name: None)
    assert api.start_project_session(str(d))["error"] == "未找到 claude，请在设置中配置路径"

def test_pick_folder_returns_path(tmp_path):
    """选择文件夹：FOLDER_DIALOG 返回路径列表 → {"ok": True, "path": 首个}。"""
    d = tmp_path / "选中"
    d.mkdir()

    class FakeWin:
        def create_file_dialog(self, *a, **k):
            return (str(d),)

    api = AppApi(settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    api._window = FakeWin()
    assert api.pick_folder() == {"ok": True, "path": str(d), "name": "选中", "error": None}

def test_pick_folder_cancel(tmp_path):
    """用户取消：create_file_dialog 返回 None → {"ok": True, "path": None}。"""
    class FakeWin:
        def create_file_dialog(self, *a, **k):
            return None

    api = AppApi(settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    api._window = FakeWin()
    assert api.pick_folder() == {"ok": True, "path": None, "name": None, "error": None}

def test_pick_folder_no_window(tmp_path):
    """_window 未赋值（单元测试/初始化前）→ 错误 dict 不抛异常。"""
    api = AppApi(settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    r = api.pick_folder()
    assert r == {"ok": False, "path": None, "name": None, "error": "窗口未就绪"}

# ---- close_window（替代 JS window.close()，pywebview 6.2.1 下它是空操作）----

def test_close_window_calls_destroy(tmp_path):
    """close_window 必须调用 Python 侧 _window.destroy()。"""
    calls = []

    class FakeWin:
        def destroy(self):
            calls.append(1)

    api = AppApi(settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    api._window = FakeWin()
    assert api.close_window() == {"ok": True, "error": None}
    assert calls == [1]

def test_close_window_no_window(tmp_path):
    api = AppApi(settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    assert api.close_window()["ok"] is False

# ---- 项目排序（move_project）与会话移动（move_session_to_project） ----

def test_move_project_reorder(tmp_path):
    """排序：移到指定项目之前 / 移到末尾（dst 空串）；顺序持久化、count 不落盘。"""
    d1 = tmp_path / "一"
    d2 = tmp_path / "二"
    d3 = tmp_path / "三"
    for d in (d1, d2, d3):
        d.mkdir()
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=pfile)
    for name, d in (("一", d1), ("二", d2), ("三", d3)):
        api.add_project(name, str(d))
    assert api.move_project(str(d3), str(d1)) == {"ok": True, "error": None}
    assert [p["name"] for p in api.list_projects()] == ["三", "一", "二"]
    assert api.move_project(str(d1), "") == {"ok": True, "error": None}
    assert [p["name"] for p in api.list_projects()] == ["三", "二", "一"]
    saved = json.loads(pfile.read_text(encoding="utf-8"))
    assert [p["name"] for p in saved] == ["三", "二", "一"]     # 持久化顺序一致
    assert not pfile.with_name("projects.json.tmp").exists()    # 原子写不留 tmp

def test_move_project_errors(tmp_path):
    """src / dst 不存在：明确错误且列表不变。"""
    d1 = tmp_path / "一"
    d2 = tmp_path / "二"
    d1.mkdir()
    d2.mkdir()
    pfile = tmp_path / "projects.json"
    api = AppApi(projects_dir=tmp_path / "projects", trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=pfile)
    api.add_project("一", str(d1))
    api.add_project("二", str(d2))
    assert api.move_project(str(tmp_path / "不存在"), str(d2))["error"] == "项目不存在"
    assert api.move_project(str(d1), str(tmp_path / "不存在"))["error"] == "目标项目不存在"
    assert [p["name"] for p in api.list_projects()] == ["一", "二"]   # 失败不改列表

def test_move_session_to_project_requires_registered(tmp_path, make_session_file):
    """目标必须已注册为项目；注册后移动成功，卡片归属随之切换。"""
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    import os
    import time
    p = make_session_file(projects, _munge_path(src_proj), "m1", "2026-08-01T10:00:00+00:00", "x")
    t = time.time() - 10000
    os.utime(p, (t, t))   # 做旧：刚写入的文件会被活动守卫拒绝
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path],
                 projects_path=tmp_path / "p.json")
    assert api.move_session_to_project("m1", str(dst_proj)) == {"ok": False, "error": "目标不是已添加的项目"}
    assert api.move_session_to_project("m1", "") == {"ok": False, "error": "目标项目路径为空"}
    api.add_project("目标", str(dst_proj))
    assert api.move_session_to_project("m1", str(dst_proj)) == {"ok": True, "error": None}
    assert api.project_sessions(str(dst_proj))[0]["id"] == "m1"      # 新项目卡片可见
    assert api.project_sessions(str(src_proj)) == []                 # 旧项目不再有
    assert api.move_session_to_project("nope", str(dst_proj))["error"] == "未找到会话"

def test_move_session_enter_uses_new_cwd(tmp_path, monkeypatch):
    """移动后进入会话：从新项目目录启动 claude --resume（cwd 记录已改写，不走扫描）。"""
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "en111"
    d = projects / _munge_path(src_proj)
    d.mkdir(parents=True)
    (d / f"{sid}.jsonl").write_text(json.dumps({"type": "user", "cwd": str(src_proj),
                                                "message": {"role": "user", "content": "x"}},
                                               ensure_ascii=False) + "\n", encoding="utf-8")
    import os
    import time
    t = time.time() - 10000
    os.utime(d / f"{sid}.jsonl", (t, t))   # 做旧：刚写入的文件会被活动守卫拒绝
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", projects_path=tmp_path / "p.json")
    api.add_project("目标", str(dst_proj))
    assert api.move_session_to_project(sid, str(dst_proj))["ok"] is True
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    import subprocess
    calls = []
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)) or None)
    assert api.enter(sid, roots=[tmp_path / "其他"])["ok"] is True
    assert calls[0][0] == ["C:/fake/claude.exe", "--resume", sid]
    assert calls[0][1]["cwd"] == str(dst_proj)                       # 新项目目录

def test_project_sessions_fallback_recorded_cwd(tmp_path):
    """项目文件夹在扫描根之外：_project_hit 用转录首条 cwd 兜底，会话仍显示在
    项目卡片与计数中（move_session 移入自定义目录后不「消失」）。"""
    dst_proj = tmp_path / "外部项目"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "out111"
    d = projects / _munge_path(dst_proj)
    d.mkdir(parents=True)
    (d / f"{sid}.jsonl").write_text(json.dumps({"type": "user", "cwd": str(dst_proj),
                                                "message": {"role": "user", "content": "外部会话"}},
                                               ensure_ascii=False) + "\n", encoding="utf-8")
    api = AppApi(projects_dir=projects, trash_dir=tmp_path / "trash",
                 settings_path=tmp_path / "s.json", roots=[tmp_path / "不存在的根"],
                 projects_path=tmp_path / "p.json")
    api.add_project("外部", str(dst_proj))
    assert api.project_sessions(str(dst_proj))[0]["id"] == sid
    assert api.list_projects()[0]["count"] == 1

def test_enter_case_insensitive_cwd_slug(tmp_path, monkeypatch):
    """JSONL cwd 与 slug 大小写写法不同（Windows 大小写不敏感）：仍按记录启动。"""
    proj = tmp_path / "CaseProj"
    proj.mkdir()
    sid = "ci111"
    projects = tmp_path / "projects"
    d = projects / _munge_path(proj)
    d.mkdir(parents=True)
    (d / f"{sid}.jsonl").write_text(json.dumps({"cwd": str(proj).upper()},
                                               ensure_ascii=False) + "\n", encoding="utf-8")
    api = AppApi(projects_dir=projects, settings_path=tmp_path / "s.json")
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    import subprocess
    calls = []
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)) or None)
    assert api.enter(sid, roots=[tmp_path / "其他"])["ok"] is True
    assert calls[0][1]["cwd"] == str(proj).upper()

# ---- 冒烟自关 env 解析（_smoke_auto_close_ms 纯函数） ----

def test_smoke_auto_close_ms(monkeypatch):
    from app import _smoke_auto_close_ms
    monkeypatch.delenv("SESSION_MANAGER_SMOKE_AUTO_CLOSE_MS", raising=False)
    assert _smoke_auto_close_ms() is None                 # 未设置
    monkeypatch.setenv("SESSION_MANAGER_SMOKE_AUTO_CLOSE_MS", "5000")
    assert _smoke_auto_close_ms() == 5.0                  # 有效值 → 秒
    monkeypatch.setenv("SESSION_MANAGER_SMOKE_AUTO_CLOSE_MS", "1")
    assert _smoke_auto_close_ms() == 0.001
    for bad in ("0", "-3", "abc", "5.5", " 5000"):
        monkeypatch.setenv("SESSION_MANAGER_SMOKE_AUTO_CLOSE_MS", bad)
        assert _smoke_auto_close_ms() is None, f"无效值 {bad!r} 应被忽略"

# ---- enter 防重复进入（分叉保护） ----

def _enter_ready(tmp_path, sid="abc123"):
    """构造一个可进入的会话（含精确 cwd 记录），返回 (api, projects_dir)。"""
    project = tmp_path / "project"
    project.mkdir()
    projects_dir = tmp_path / "projects"
    session_file = projects_dir / _munge_path(project) / f"{sid}.jsonl"
    session_file.parent.mkdir(parents=True)
    session_file.write_text(json.dumps({"cwd": str(project)}) + "\n", encoding="utf-8")
    api = AppApi(projects_dir=projects_dir, settings_path=tmp_path / "s.json")
    return api

def test_api_enter_cooldown_blocks_second_launch(tmp_path, monkeypatch):
    """同一会话 5 秒内第二次 enter 被拒绝：快速双击/连点不会并行启动两个
    claude --resume（否则 Claude Code 会把第二个进程分叉成重复会话，实测
    2026-08-06 project_007）。"""
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    api = _enter_ready(tmp_path)
    calls = []
    monkeypatch.setattr("subprocess.Popen", lambda cmd, **kw: calls.append(cmd) or None)
    assert api.enter("abc123")["ok"] is True
    assert api.enter("abc123")["ok"] is False      # 冷却期内拒绝
    assert len(calls) == 1                          # 只启动了一次

def test_api_enter_cooldown_per_session(tmp_path, monkeypatch):
    """冷却按 session_id 隔离：不同会话互不影响。"""
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    api = _enter_ready(tmp_path, sid="aaa")
    project = tmp_path / "project2"
    project.mkdir()
    projects_dir = tmp_path / "projects"
    f2 = projects_dir / _munge_path(project) / "bbb.jsonl"
    f2.parent.mkdir(parents=True)
    f2.write_text(json.dumps({"cwd": str(project)}) + "\n", encoding="utf-8")
    calls = []
    monkeypatch.setattr("subprocess.Popen", lambda cmd, **kw: calls.append(cmd) or None)
    assert api.enter("aaa")["ok"] is True
    assert api.enter("bbb")["ok"] is True           # 不同会话不被冷却
    assert api.enter("aaa")["ok"] is False          # 同一会话仍被冷却
    assert len(calls) == 2

def test_api_enter_cooldown_not_set_on_failure(tmp_path, monkeypatch):
    """启动失败（claude 未找到）不记录冷却：修复后立即重试不被拦截。"""
    api = _enter_ready(tmp_path)
    monkeypatch.setattr("shutil.which", lambda name: None)
    assert api.enter("abc123")["ok"] is False
    calls = []
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    monkeypatch.setattr("subprocess.Popen", lambda cmd, **kw: calls.append(cmd) or None)
    assert api.enter("abc123")["ok"] is True        # 失败不锁冷却
    assert len(calls) == 1

def test_session_dict_includes_forked(fixture_projects_dir, make_session_file, fixture_trash_dir, tmp_path):
    """前端序列化必须透传 forked 字段（分叉徽标的数据来源）。"""
    make_session_file(fixture_projects_dir, "D--Count-Obsidian-main-project-002-----VPS", "aaa111",
                      "2026-08-01T10:00:00+00:00", "来了")
    api = AppApi(projects_dir=fixture_projects_dir, trash_dir=fixture_trash_dir,
                 settings_path=tmp_path / "s.json")
    s = api.list_sessions()[0]["sessions"][0]
    assert "forked" in s and s["forked"] is False

# ---- enter 进程级占用检测（终极防分叉） ----

def test_api_enter_blocks_when_session_process_alive(tmp_path, monkeypatch):
    """目标会话有存活 claude 进程（含窗口已关的后台作业）时拒绝进入，
    防止 Claude Code 自动分叉成重复会话。"""
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    api = _enter_ready(tmp_path)
    monkeypatch.setattr("app.session_live_pids", lambda sid: ["27032", "30736"])
    calls = []
    monkeypatch.setattr("subprocess.Popen", lambda cmd, **kw: calls.append(cmd) or None)
    result = api.enter("abc123")
    assert result["ok"] is False
    assert result["code"] == "session_running"
    assert result["pids"] == ["27032", "30736"]
    assert calls == []                       # 未启动 claude

def test_api_enter_allows_when_no_process(tmp_path, monkeypatch):
    """无存活进程（真·已关闭）时正常进入，不受进程检测影响。"""
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    api = _enter_ready(tmp_path)
    monkeypatch.setattr("app.session_live_pids", lambda sid: [])
    calls = []
    monkeypatch.setattr("subprocess.Popen", lambda cmd, **kw: calls.append(cmd) or None)
    assert api.enter("abc123")["ok"] is True
    assert len(calls) == 1

def test_session_live_pids_parses_command_lines(monkeypatch):
    """命令行解析：会话本体 --session-id / 恢复 --resume 独立参数命中；
    --fork-session --resume <路径> 的路径形式（源会话 id 只是路径子串）不命中，
    源会话进程已死时允许重新进入；--resume=id 等号形式命中。"""
    import app
    fake_out = ("27032|C:\claude.exe --session-id abc123-xxxx --fork-session --resume C:\proj\src\abc123-xxxx.jsonl\n"
                "30736|C:\claude.exe --bg-pty-host pipe-abc123-xxxx\n"
                "12940|C:\claude.exe --resume def456-xxxx\n"
                "35104|C:\claude.exe --session-id zzz999\n"
                "88888|C:\claude.exe --resume=abc123-xxxx\n"
                "99999|C:\claude.exe --resume C:\proj\other\abc123-xxxx.jsonl\n")
    monkeypatch.setattr("subprocess.check_output", lambda *a, **kw: fake_out)
    assert app.session_live_pids("abc123-xxxx") == ["27032", "88888"]   # 路径形式 99999 不命中
    assert app.session_live_pids("def456-xxxx") == ["12940"]
    assert app.session_live_pids("zzz999") == ["35104"]
    assert app.session_live_pids("nope") == []

def test_session_live_pids_graceful_on_error(monkeypatch):
    """powershell 查询失败（无权限/超时）返回 []，不阻塞进入。"""
    import app
    def boom(*a, **kw):
        raise OSError("powershell 不可用")
    monkeypatch.setattr("subprocess.check_output", boom)
    assert app.session_live_pids("abc123") == []

# ---- 残留进程清理（分叉残留 / 孤儿会话） ----

FAKE_PROC_LINES = (
    "14116|C:\claude.exe daemon run --origin transient --spawned-by claude\n"
    "27032|C:\claude.exe --session-id 93a355e2-7eba-4ac2-8775-2bb4f0a02142 --fork-session --resume C:\proj\cc43c95b-4723-49a3-953f-123cc50e9212.jsonl\n"
    "30736|C:\claude.exe --bg-pty-host \\.\pipe\cc-daemon-xxx-pty-93a355e2-7eba-4ac2-8775-2bb4f0a02142 209 54\n"
    "21156|C:\claude.exe --session-id 49af3e21-ce6b-4c22-b7b1-5defc9a81119 --permission-mode auto\n"
    "33420|C:\claude.exe --bg-pty-host \\.\pipe\cc-daemon-xxx-pty-49af3e21-ce6b-4c22-b7b1-5defc9a81119 120 30\n"
    "12940|C:\claude.exe --session-id 11111111-2222-3333-4444-555555555555 --fork-session --resume C:\proj\00000000-aaaa-bbbb-cccc-dddddddddddd.jsonl\n"
)

def _make_api_with_procs(tmp_path, proc_lines, projects_dir):
    import app as app_mod
    monkeypatch = None
    # 通过 monkeypatch 注入扫描输出（在测试内自行处理）
    return proc_lines

def test_scan_stale_classifies(monkeypatch, tmp_path):
    """分类：分叉进程 + 其 pty 伴生 + 孤儿会话 = 残留；活跃会话 + daemon = 活跃。"""
    import app as app_mod
    # 构造 projects 目录：49af3e21 存在（活跃），orphan111 不存在（孤儿）
    projects = tmp_path / "projects"
    (projects / "D--x").mkdir(parents=True)
    (projects / "D--x" / "49af3e21-ce6b-4c22-b7b1-5defc9a81119.jsonl").write_text("x", encoding="utf-8")
    api = AppApi(projects_dir=projects, settings_path=tmp_path / "s.json")
    monkeypatch.setattr(app_mod, "_scan_claude_processes",
                        lambda: app_mod._parse_proc_lines(FAKE_PROC_LINES))
    r = api.scan_stale_processes()
    stale = {p["pid"]: p for p in r["stale"]}
    active = {p["pid"]: p for p in r["active"]}
    # 残留：分叉 27032 + 伴生 pty 30736 + 孤儿分叉 12940
    assert set(stale) == {"27032", "30736", "12940"}
    assert stale["27032"]["kind"] == "分叉残留"
    assert stale["30736"]["kind"] == "伴生进程"
    assert stale["12940"]["kind"] == "分叉残留"
    # 活跃：daemon 14116 + 49af3e21 会话 21156 + 其 pty 33420
    assert set(active) == {"14116", "21156", "33420"}
    assert active["14116"]["kind"].startswith("daemon")
    assert active["21156"]["kind"] == "活跃会话"
    assert active["33420"]["kind"] == "后台终端"

def test_kill_only_accepts_current_stale(monkeypatch, tmp_path):
    """kill 前重新扫描交叉验证：不在当前残留集合的 pid 拒绝执行，防误杀。"""
    import app as app_mod
    projects = tmp_path / "projects"
    (projects / "D--x").mkdir(parents=True)
    (projects / "D--x" / "49af3e21-ce6b-4c22-b7b1-5defc9a81119.jsonl").write_text("x", encoding="utf-8")
    api = AppApi(projects_dir=projects, settings_path=tmp_path / "s.json")
    monkeypatch.setattr(app_mod, "_scan_claude_processes",
                        lambda: app_mod._parse_proc_lines(FAKE_PROC_LINES))
    kills = []
    monkeypatch.setattr("subprocess.run", lambda cmd, **kw: kills.append(cmd) or type("R", (), {"returncode": 0, "stderr": "", "stdout": ""})())
    res = api.kill_stale_processes(["27032", "21156", "99999"])
    assert res["27032"] == "已终止"
    assert res["21156"] == "已不在残留列表（跳过）"   # 活跃会话拒绝杀
    assert res["99999"] == "已不在残留列表（跳过）"   # 未知 pid 拒绝杀
    assert kills == [["taskkill", "/PID", "27032", "/F"]]   # 只执行了合法目标

# ===== 跨实例互斥：enter() 集成（2026-08-08）=====

def _enter_fixture(tmp_path, monkeypatch, sid="abc123"):
    """与 test_api_enter_spawns 相同的进入 fixture：返回 (api, projects_dir, sid)。"""
    monkeypatch.setattr("shutil.which", lambda name: "C:/fake/claude.exe")
    project = tmp_path / "project"
    project.mkdir()
    projects_dir = tmp_path / "projects"
    session_file = projects_dir / _munge_path(project) / f"{sid}.jsonl"
    session_file.parent.mkdir(parents=True)
    session_file.write_text(json.dumps({"cwd": str(project)}) + "\n", encoding="utf-8")
    import subprocess
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: None)
    api = AppApi(projects_dir=projects_dir, settings_path=tmp_path / "s.json")
    return api, projects_dir, sid

def test_api_enter_rejected_while_lock_held(tmp_path, monkeypatch):
    from sessions_core import acquire_enter_lock, release_enter_lock
    import os
    api, projects_dir, sid = _enter_fixture(tmp_path, monkeypatch)
    slug = _munge_path(tmp_path / "project")
    lock_path = projects_dir / slug / f".{sid}.enter.lock"
    ok, _ = acquire_enter_lock(lock_path, pid=os.getpid())   # 模拟另一实例持有锁
    assert ok
    res = api.enter(sid)
    assert res["ok"] is False and res.get("code") == "enter_locked"
    assert "另一实例" in res["error"]
    release_enter_lock(lock_path)
    assert api.enter(sid)["ok"] is True                      # 放锁后可正常进入

def test_api_enter_releases_lock_after_spawn(tmp_path, monkeypatch):
    api, projects_dir, sid = _enter_fixture(tmp_path, monkeypatch)
    slug = _munge_path(tmp_path / "project")
    lock_path = projects_dir / slug / f".{sid}.enter.lock"
    assert api.enter(sid)["ok"] is True
    assert not lock_path.exists()                            # 启动完成后锁已释放

def test_api_enter_releases_lock_on_failure(tmp_path, monkeypatch):
    """cwd 解析失败（目录被删）也必须放锁，否则锁残留要靠死 PID 自愈。"""
    api, projects_dir, sid = _enter_fixture(tmp_path, monkeypatch)
    slug = _munge_path(tmp_path / "project")
    lock_path = projects_dir / slug / f".{sid}.enter.lock"
    (tmp_path / "project").rmdir()                           # 原工作目录消失 → project_dir_missing
    res = api.enter(sid)
    assert res["ok"] is False
    assert not lock_path.exists()                            # finally 已放锁
