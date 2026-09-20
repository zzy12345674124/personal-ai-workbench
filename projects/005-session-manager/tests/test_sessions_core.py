import json
import os
from pathlib import Path
from sessions_core import list_sessions, group_by_project, friendly_name, Session, stats, search, search_all
from sessions_core import delete_sessions, restore_sessions, purge_trash, list_trash
from sessions_core import rename_session, move_session, munge_path
from sessions_core import acquire_enter_lock, release_enter_lock

def test_list_parses_and_sorts(sample_sessions):
    sessions = list_sessions(sample_sessions)
    assert len(sessions) == 3
    assert sessions[0].id == "aaa111"          # 最新在前
    assert sessions[0].preview == "来了"
    assert "2026-08-01" in sessions[0].when
    assert sessions[0].project == "D--Count-Obsidian-main-project-002-----VPS"

def test_exclude(sample_sessions):
    sessions = list_sessions(sample_sessions, exclude="aaa111")
    assert all(s.id != "aaa111" for s in sessions)

def test_group_by_project(sample_sessions):
    """分组键已从 slug 改为显示名：group["project"] 现在是显示名（合并键）。"""
    groups = group_by_project(list_sessions(sample_sessions))
    assert [g["project"] for g in groups] == ["project_002 VPS", "Home"]
    assert groups[0]["count"] == 2
    assert groups[0]["size_kb"] > 0
    assert groups[1]["friendly"] == "Home" and groups[1]["count"] == 1

def test_group_merges_home_slugs(fixture_projects_dir, make_session_file):
    """friendly 相同的不同 slug（C--Users-20714 与 C--Users-20714-Desktop---）
    合并为一组：count/size_kb 求和、组内保持时间倒序、s.project（slug）保留。"""
    make_session_file(fixture_projects_dir, "C--Users-20714", "aaa111",
                      "2026-08-01T10:00:00+00:00", "A")
    make_session_file(fixture_projects_dir, "C--Users-20714", "aaa222",
                      "2026-08-01T09:00:00+00:00", "A2")
    make_session_file(fixture_projects_dir, "C--Users-20714-Desktop---", "bbb111",
                      "2026-08-01T11:00:00+00:00", "B")
    make_session_file(fixture_projects_dir, "D--Count-Obsidian-main-project-002-----VPS", "ccc111",
                      "2026-08-01T08:00:00+00:00", "C")
    groups = group_by_project(list_sessions(fixture_projects_dir))
    assert [g["friendly"] for g in groups] == ["Home", "project_002 VPS"]
    home = groups[0]
    assert home["count"] == 3
    assert home["size_kb"] == sum(s.size_kb for s in home["sessions"])
    assert [s.id for s in home["sessions"]] == ["bbb111", "aaa111", "aaa222"]  # 组内时间倒序
    assert {s.project for s in home["sessions"]} == {"C--Users-20714", "C--Users-20714-Desktop---"}
    assert groups[1]["count"] == 1                    # 非合并组不受影响

def test_friendly_name():
    assert friendly_name("D--Count-Obsidian-main-project-002-----VPS") == "project_002 VPS"
    assert friendly_name("C--Users-20714") == "Home"
    assert friendly_name("Desktop") == "Desktop"

def test_friendly_name_project_extract_gated_to_vault():
    """project 提取门控：非 vault 根前缀的 project-NNN slug 不提取（返回原样），
    防 vault 外同名 project 目录（克隆/备份/另一盘）被误并进同一 friendly 组。"""
    assert friendly_name("X--project-002--Y") == "X--project-002--Y"
    assert friendly_name("D--Count-Obsidian-main-project-002-----VPS----") == "project_002 VPS"  # vault 前缀仍提取
    assert friendly_name("D--Count-Obsidian-main") == "D--Count-Obsidian-main"                  # vault 但无 project-NNN
    assert friendly_name("C--Users-20714-Desktop---") == "Home"                                 # Home 归并不受门控影响

def test_stats_empty(tmp_path):
    d = stats(tmp_path / "projects", tmp_path / "trash")
    assert d["total"] == 0 and d["trash_count"] == 0 and d["total_size_kb"] == 0

def test_stats_counts(sample_sessions, tmp_path, make_session_file):
    trash = tmp_path / "trash"
    # 回收站内放一个会话：<ts>_<项目>_<uuid>/<uuid>.jsonl
    trash_folder = trash / "1785600000_C--Users-20714_t1"
    trash_folder.mkdir(parents=True)
    (trash_folder / "t1.jsonl").write_text(
        '{"type": "user", "timestamp": "2026-08-01T00:00:00+00:00", "message": {"role": "user", "content": "回收站样例"}}\n',
        encoding="utf-8")
    d = stats(sample_sessions, trash)
    assert d["total"] == 3
    assert len(d["per_project"]) == 2
    assert d["trash_count"] == 1
    assert d["trash_size_kb"] > 0

def test_search_matches_preview_and_project(sample_sessions):
    hits = search("节点", sample_sessions)
    assert len(hits) == 1 and hits[0]["sessions"][0].id == "bbb222"
    hits2 = search("home", sample_sessions)
    assert any(s.id == "ccc333" for g in hits2 for s in g["sessions"])
    assert search("不存在的词", sample_sessions) == []

def test_search_case_insensitive(sample_sessions):
    assert len(search("HELLO", sample_sessions)) == 1

def test_search_matches_full_claude_transcript(fixture_projects_dir, make_session_file):
    path = make_session_file(fixture_projects_dir, "C--Users-20714", "full111",
                             "2026-08-01T10:00:00+00:00", "开场白")
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"type": "assistant", "timestamp": "2026-08-01T10:01:00+00:00",
                                 "message": {"role": "assistant", "content": "正文深处的虚构暗号"}},
                                ensure_ascii=False) + "\n")
    hits = search("虚构暗号", fixture_projects_dir)
    assert hits[0]["sessions"][0].id == "full111"
    assert "虚构暗号" in hits[0]["sessions"][0].preview

def test_fulltext_cache_invalidates_when_transcript_changes(fixture_projects_dir, make_session_file):
    path = make_session_file(fixture_projects_dir, "C--Users-20714", "cache111",
                             "2026-08-01T10:00:00+00:00", "缓存前内容")
    assert search("缓存后新增", fixture_projects_dir) == []
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"type": "assistant", "timestamp": "2026-08-01T10:02:00+00:00",
                                 "message": {"role": "assistant", "content": "缓存后新增正文"}},
                                ensure_ascii=False) + "\n")
    assert search("缓存后新增", fixture_projects_dir)[0]["sessions"][0].id == "cache111"

def _write_codex_rollout(root: Path, sid: str, cwd: str, user: str, assistant: str) -> Path:
    path = root / f"rollout-2026-08-24T10-00-00-{sid}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {"timestamp": "2026-08-24T10:00:00Z", "type": "session_meta",
         "payload": {"id": sid, "timestamp": "2026-08-24T10:00:00Z", "cwd": cwd}},
        {"timestamp": "2026-08-24T10:00:01Z", "type": "event_msg",
         "payload": {"type": "user_message", "message": user}},
        {"timestamp": "2026-08-24T10:00:02Z", "type": "response_item",
         "payload": {"type": "message", "role": "assistant",
                     "content": [{"type": "output_text", "text": assistant}]}},
    ]
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    return path

def test_cross_tool_search_reads_codex_active_and_archived(tmp_path, fixture_projects_dir):
    active_root = tmp_path / "codex" / "sessions"
    archived_root = tmp_path / "codex" / "archived"
    _write_codex_rollout(active_root, "11111111-1111-1111-1111-111111111111",
                         str(tmp_path / "project_alpha"), "普通开场", "跨工具虚构命中")
    _write_codex_rollout(archived_root, "22222222-2222-2222-2222-222222222222",
                         str(tmp_path / "project_beta"), "归档虚构命中", "完成")
    hits = search_all("虚构命中", fixture_projects_dir, active_root, archived_root)
    sessions = [s for group in hits for s in group["sessions"]]
    assert {s.source_tool for s in sessions} == {"codex"}
    assert {s.archived for s in sessions} == {False, True}
    assert all(s.readonly for s in sessions)
    assert {group["friendly"] for group in hits} == {"Codex · project_alpha", "Codex · project_beta"}

def test_delete_restore_purge_roundtrip(sample_sessions, fixture_trash_dir):
    ids = [s.id for s in list_sessions(sample_sessions)]
    res = delete_sessions(ids[:1], sample_sessions, fixture_trash_dir)   # 删第一个
    assert all("已移入" in v for v in res.values())
    assert len(list_trash(fixture_trash_dir)) == 1
    n = restore_sessions([ids[0]], fixture_trash_dir, sample_sessions)
    assert n == 1 and len(list_trash(fixture_trash_dir)) == 0
    delete_sessions(ids, sample_sessions, fixture_trash_dir)
    assert purge_trash(fixture_trash_dir) == len(ids)
    assert len(list_trash(fixture_trash_dir)) == 0

def test_delete_unknown_id(sample_sessions, fixture_trash_dir):
    res = delete_sessions(["nope"], sample_sessions, fixture_trash_dir)
    assert "nope" in res and "未找到" in res["nope"]

def test_delete_restore_sidecar_roundtrip(sample_sessions, fixture_trash_dir):
    """带 sidecar 目录（subagents/）的会话：delete 移入 trash 时目录同在，restore 一并归位。"""
    s = list_sessions(sample_sessions)[0]
    sidecar_json = Path(sample_sessions) / s.project / s.id / "subagents" / "agent-test.jsonl"
    sidecar_json.parent.mkdir(parents=True, exist_ok=True)
    sidecar_json.write_text("{}", encoding="utf-8")

    res = delete_sessions([s.id], sample_sessions, fixture_trash_dir)
    assert all("已移入" in v for v in res.values())
    trash_folder = fixture_trash_dir / f"{s.ts:.0f}_{s.project}_{s.id}"
    assert (trash_folder / f"{s.id}.jsonl").is_file()
    assert (trash_folder / s.id / "subagents" / "agent-test.jsonl").is_file()

    n = restore_sessions([s.id], fixture_trash_dir, sample_sessions)
    assert n == 1
    assert len(list_trash(fixture_trash_dir)) == 0
    assert sidecar_json.is_file()   # sidecar 目录随 jsonl 一并归位
    assert (Path(sample_sessions) / s.project / f"{s.id}.jsonl").is_file()

def test_list_skips_non_dict_json_lines(fixture_projects_dir):
    """合法 JSON 但非 dict 的转录行（数组/字符串/数字）应被跳过，不崩溃。"""
    p = fixture_projects_dir / "C--Users-20714" / "xyz777.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        "[1, 2, 3]\n"
        '{"type": "user", "timestamp": "2026-08-01T10:00:00+00:00", '
        '"message": {"role": "user", "content": "正常会话"}}\n'
        '"字符串行"\n'
        "42\n",
        encoding="utf-8")
    sessions = list_sessions(fixture_projects_dir)
    assert len(sessions) == 1
    assert sessions[0].preview == "正常会话"
    assert sessions[0].when.startswith("2026-08-01")

def test_restore_target_exists(sample_sessions, fixture_trash_dir):
    """恢复目标 jsonl 已存在：不崩溃、不覆盖活动会话，返回明确失败结果（负数=失败数）。"""
    s = list_sessions(sample_sessions)[0]
    delete_sessions([s.id], sample_sessions, fixture_trash_dir)
    dest = Path(sample_sessions) / s.project / f"{s.id}.jsonl"
    dest.write_text('{"type": "user", "message": {"role": "user", "content": "新活动会话"}}\n',
                    encoding="utf-8")
    n = restore_sessions([s.id], fixture_trash_dir, sample_sessions)
    assert n == -1
    assert len(list_trash(fixture_trash_dir)) == 1   # 原文件仍留在回收站，未被覆盖
    assert dest.read_text(encoding="utf-8").startswith('{"type": "user"')

def test_list_trash_size_kb_rounds_up(sample_sessions, fixture_trash_dir):
    s = list_sessions(sample_sessions)[0]
    delete_sessions([s.id], sample_sessions, fixture_trash_dir)
    items = list_trash(fixture_trash_dir)
    assert len(items) == 1 and items[0]["size_kb"] == 1  # 亚 KB 文件向上取整为 1KB

# ---- 会话标题：首行 custom-title 提取 ----

def _prepend_title(path, sid, title):
    """在转录文件首行前插入 Claude 原生格式的 custom-title 记录。"""
    record = json.dumps({"type": "custom-title", "customTitle": title,
                         "sessionId": sid}, ensure_ascii=False) + "\n"
    path.write_text(record + path.read_text(encoding="utf-8"), encoding="utf-8")

def test_list_sessions_reads_custom_title(fixture_projects_dir, make_session_file):
    p = make_session_file(fixture_projects_dir, "C--Users-20714", "ttt111",
                          "2026-08-01T10:00:00+00:00", "首条消息")
    _prepend_title(p, "ttt111", "测试标题ABC")
    sessions = list_sessions(fixture_projects_dir)
    assert sessions[0].id == "ttt111"
    assert sessions[0].title == "测试标题ABC"
    assert sessions[0].preview == "首条消息"      # 标题记录不影响消息预览提取

def test_list_sessions_title_none_without_custom_title(fixture_projects_dir, make_session_file):
    make_session_file(fixture_projects_dir, "C--Users-20714", "ntt111",
                      "2026-08-01T10:00:00+00:00", "无标题")
    sessions = list_sessions(fixture_projects_dir)
    assert sessions[0].title is None

def test_list_sessions_title_tolerant_bad_first_line(fixture_projects_dir):
    """首行解析失败/非 dict：跳过，title 为 None，不崩溃。"""
    p = fixture_projects_dir / "C--Users-20714" / "btl111.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("这不是JSON\n"
                 "[1, 2, 3]\n"
                 '{"type": "custom-title", "customTitle": "不应读到", "sessionId": "btl111"}\n'
                 '{"type": "user", "timestamp": "2026-08-01T10:00:00+00:00", '
                 '"message": {"role": "user", "content": "正常"}}\n',
                 encoding="utf-8")
    sessions = list_sessions(fixture_projects_dir)
    assert sessions[0].title is None             # 只读首条记录，损坏/非 dict 均视为无标题
    assert sessions[0].preview == "正常"          # user 消息内容正常提取

# ===== 跨实例互斥锁（2026-08-08）=====

def test_enter_lock_acquire_release_roundtrip(tmp_path):
    p = tmp_path / ".s1.enter.lock"
    ok, err = acquire_enter_lock(p)
    assert ok and err is None
    assert p.exists()
    data = json.loads(p.read_text(encoding="utf-8"))
    assert data["pid"] == os.getpid()            # 锁内记录持有者 PID（残留检测用）
    release_enter_lock(p)
    assert not p.exists()

def test_enter_lock_held_by_live_pid_rejects(tmp_path):
    p = tmp_path / ".s1.enter.lock"
    ok, _ = acquire_enter_lock(p, pid=os.getpid())   # 当前进程 = 存活 PID
    assert ok
    ok2, err2 = acquire_enter_lock(p, pid=os.getpid())
    assert not ok2
    assert "另一实例" in err2
    assert p.exists()                            # 被活锁拒绝时不改动锁

def test_enter_lock_stale_pid_auto_cleaned(tmp_path):
    p = tmp_path / ".s1.enter.lock"
    p.write_text(json.dumps({"pid": 99999999, "ts": 0.0}), encoding="utf-8")  # 持有者不存在
    ok, err = acquire_enter_lock(p)
    assert ok and err is None                    # 残留自动清理并重试成功
    assert p.exists()

def test_enter_lock_corrupt_file_treated_stale(tmp_path):
    p = tmp_path / ".s1.enter.lock"
    p.write_text("不是JSON", encoding="utf-8")
    ok, _ = acquire_enter_lock(p)
    assert ok                                    # 内容损坏按残留清理

def test_release_missing_lock_is_silent(tmp_path):
    release_enter_lock(tmp_path / ".nope.enter.lock")   # 不存在不抛错

def test_search_matches_title(fixture_projects_dir, make_session_file):
    p = make_session_file(fixture_projects_dir, "C--Users-20714", "srh111",
                          "2026-08-01T10:00:00+00:00", "无关预览文本")
    _prepend_title(p, "srh111", "量子隧穿研究")
    hits = search("量子隧穿", fixture_projects_dir)
    assert len(hits) == 1 and hits[0]["sessions"][0].id == "srh111"
    assert hits[0]["sessions"][0].title == "量子隧穿研究"

# ---- 重命名：新增 / 更新 / 拒绝路径 / 原生字节格式 ----

def test_rename_inserts_custom_title_first_line(fixture_projects_dir, make_session_file):
    """无标题会话：前置插入 custom-title，原内容逐字节整体后移。"""
    p = make_session_file(fixture_projects_dir, "C--Users-20714", "rnn111",
                          "2026-08-01T10:00:00+00:00", "首条消息")
    original = p.read_bytes()
    r = rename_session("rnn111", "测试标题ABC", fixture_projects_dir)
    assert r == {"ok": True, "title": "测试标题ABC"}
    expected_first = json.dumps({"type": "custom-title", "customTitle": "测试标题ABC",
                                 "sessionId": "rnn111"}, ensure_ascii=False).encode("utf-8")
    after = p.read_bytes()
    assert after == expected_first + b"\n" + original.split(b"\n", 1)[1]
    # 重命名后 list 能看到标题
    assert list_sessions(fixture_projects_dir)[0].title == "测试标题ABC"

def test_rename_updates_existing_custom_title(fixture_projects_dir, make_session_file):
    """已有 custom-title 首行：原地改值，其余内容不动，首行格式保持键序。"""
    p = make_session_file(fixture_projects_dir, "C--Users-20714", "upd111",
                          "2026-08-01T10:00:00+00:00", "首条消息")
    _prepend_title(p, "upd111", "旧标题")
    rest = p.read_bytes().split(b"\n", 1)[1]
    r = rename_session("upd111", "新标题XYZ", fixture_projects_dir)
    assert r["ok"] is True and r["title"] == "新标题XYZ"
    after = p.read_bytes()
    expected_first = json.dumps({"type": "custom-title", "customTitle": "新标题XYZ",
                                 "sessionId": "upd111"}, ensure_ascii=False).encode("utf-8")
    assert after == expected_first + b"\n" + rest      # 仅首行变化
    assert after.count(b"custom-title") == 1

def test_rename_empty_title_noop(fixture_projects_dir, make_session_file):
    """留空/全空白：不修改文件，返回明确错误（留空=不改）。"""
    p = make_session_file(fixture_projects_dir, "C--Users-20714", "emp111",
                          "2026-08-01T10:00:00+00:00", "首条消息")
    before = p.read_bytes()
    for bad in ("", "   ", "\t\n"):
        r = rename_session("emp111", bad, fixture_projects_dir)
        assert r == {"ok": False, "error": "标题为空，未修改"}
    assert p.read_bytes() == before

def test_rename_title_too_long(fixture_projects_dir, make_session_file):
    p = make_session_file(fixture_projects_dir, "C--Users-20714", "len111",
                          "2026-08-01T10:00:00+00:00", "首条消息")
    before = p.read_bytes()
    r = rename_session("len111", "长" * 101, fixture_projects_dir)
    assert r["ok"] is False and "标题过长" in r["error"]
    assert p.read_bytes() == before                  # 拒绝路径不碰文件

def test_rename_session_not_found(tmp_path):
    r = rename_session("deadbeef", "标题", tmp_path / "projects")
    assert r == {"ok": False, "error": "未找到会话"}

# ---- 会话移动（move_session：改写 cwd + 迁移文件） ----

def _write_session_with_cwd(projects_dir, slug, sid, cwd):
    """工厂：写一个含 cwd 记录的转录（custom-title 首行 + user/assistant 带 cwd +
    一条合法非 dict 行），供移动测试校验改写与逐字节保留。"""
    p = Path(projects_dir) / slug / f"{sid}.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps({"type": "custom-title", "customTitle": "移动测试", "sessionId": sid},
                   ensure_ascii=False) + "\n"
        + json.dumps({"type": "user", "cwd": cwd, "timestamp": "2026-08-01T10:00:00+00:00",
                      "message": {"role": "user", "content": "你好"}}, ensure_ascii=False) + "\n"
        + "[1, 2, 3]\n"
        + json.dumps({"type": "assistant", "cwd": cwd,
                      "message": {"role": "assistant", "content": "ok"}}, ensure_ascii=False) + "\n",
        encoding="utf-8", newline="\n")   # 强制 LF：与 Claude Code 真实转录一致（Windows 文本模式默认转 CRLF）
    # 刚写入的文件会被 move_session 的活动守卫拒绝：统一做旧到 10 分钟前
    import os
    import time
    t = time.time() - 10000
    os.utime(p, (t, t))
    return p

def test_move_session_rewrites_cwd_and_moves(tmp_path):
    """移动成功：文件迁到新 slug 目录；全部 cwd 改写为目标路径；无 cwd 的
    custom-title 行与合法非 dict 行逐字节保留；归属随新 slug 变化。"""
    src_proj = tmp_path / "源项目"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标项目"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "mv111"
    p = _write_session_with_cwd(projects, munge_path(src_proj), sid, str(src_proj))
    title_line = p.read_bytes().split(b"\n", 1)[0]

    r = move_session(sid, str(dst_proj), projects)

    assert r == {"ok": True, "error": None}
    assert not p.exists()                                   # 原位置已迁移
    dest = projects / munge_path(dst_proj) / f"{sid}.jsonl"
    assert dest.is_file()
    lines = dest.read_text(encoding="utf-8").splitlines()
    assert lines[0].encode("utf-8") == title_line           # 无 cwd 行逐字节保留
    assert lines[2] == "[1, 2, 3]"                          # 非 dict 行逐字节保留
    for i in (1, 3):
        e = json.loads(lines[i])
        assert e["cwd"] == str(dst_proj)                    # 全部 cwd 改写为目标目录
    assert list_sessions(projects)[0].project == munge_path(dst_proj)

def test_move_session_same_project_noop(tmp_path):
    src_proj = tmp_path / "项目"
    src_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "same111"
    p = _write_session_with_cwd(projects, munge_path(src_proj), sid, str(src_proj))
    before = p.read_bytes()
    r = move_session(sid, str(src_proj), projects)
    assert r == {"ok": False, "error": "该会话已在同一项目"}
    assert p.read_bytes() == before

def test_move_session_target_exists_aborts(tmp_path):
    """目标项目已存在同名 jsonl：拒绝且不动原文件（不覆盖）。"""
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "dup111"
    p = _write_session_with_cwd(projects, munge_path(src_proj), sid, str(src_proj))
    dest_dir = projects / munge_path(dst_proj)
    dest_dir.mkdir(parents=True)
    (dest_dir / f"{sid}.jsonl").write_text("{}", encoding="utf-8")
    before = p.read_bytes()
    r = move_session(sid, str(dst_proj), projects)
    assert r == {"ok": False, "error": "目标项目已存在同名会话"}
    assert p.read_bytes() == before

def test_move_session_not_found_and_bad_target(tmp_path):
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    assert move_session("nope", str(dst_proj), projects)["error"] == "未找到会话"
    assert move_session("nope", "", projects)["error"] == "目标项目路径不存在或不是文件夹"
    assert move_session("nope", str(tmp_path / "不存在"), projects)["error"] == "目标项目路径不存在或不是文件夹"

def test_move_session_corrupt_line_aborts(tmp_path):
    """转录含无法解析的行：整体中止（宁可不动，不丢字节），文件保持不变。"""
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "bad111"
    p = _write_session_with_cwd(projects, munge_path(src_proj), sid, str(src_proj))
    p.write_bytes(p.read_bytes() + "这不是JSON\n".encode("utf-8"))
    import os
    import time
    t = time.time() - 10000
    os.utime(p, (t, t))   # write_bytes 更新了 mtime，重新做旧避开活动守卫
    before = p.read_bytes()
    r = move_session(sid, str(dst_proj), projects)
    assert r == {"ok": False, "error": "转录存在无法解析的记录，已取消移动"}
    assert p.read_bytes() == before

def test_move_session_sidecar_moves(tmp_path):
    """sidecar 目录（subagents/）随 jsonl 一并迁移。"""
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "sc111"
    p = _write_session_with_cwd(projects, munge_path(src_proj), sid, str(src_proj))
    sidecar = p.parent / sid / "subagents"
    sidecar.mkdir(parents=True)
    (sidecar / "agent.jsonl").write_text("{}", encoding="utf-8")

    r = move_session(sid, str(dst_proj), projects)

    assert r["ok"] is True
    dest = projects / munge_path(dst_proj)
    assert (dest / sid / "subagents" / "agent.jsonl").is_file()
    assert not sidecar.exists()

def test_move_session_sidecar_failure_rolls_back(tmp_path, monkeypatch):
    """sidecar 迁移失败：jsonl 回滚到原位置，移动整体报错（不留半截状态）。"""
    import shutil
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "rb111"
    p = _write_session_with_cwd(projects, munge_path(src_proj), sid, str(src_proj))
    (p.parent / sid).mkdir()
    real_move = shutil.move

    def fake_move(src, dst):
        if str(src).endswith(sid) and not str(src).endswith(".jsonl"):
            raise OSError("模拟 sidecar 移动失败")
        return real_move(src, dst)

    monkeypatch.setattr(shutil, "move", fake_move)
    r = move_session(sid, str(dst_proj), projects)

    assert r == {"ok": False, "error": "移动会话数据失败：模拟 sidecar 移动失败"}
    assert p.is_file()                                    # jsonl 已回滚
    assert not (projects / munge_path(dst_proj) / f"{sid}.jsonl").exists()

def test_move_session_preserves_mtime(tmp_path):
    """移动后恢复原 mtime：移动本身不把会话变成"活动"，可立即再次移动/挪回
    （验收回归：刚移走的会话被活动守卫拦截，10 分钟内挪不回来）。"""
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "mt111"
    p = _write_session_with_cwd(projects, munge_path(src_proj), sid, str(src_proj))
    orig_mtime = p.stat().st_mtime
    assert move_session(sid, str(dst_proj), projects)["ok"] is True
    dest = projects / munge_path(dst_proj) / f"{sid}.jsonl"
    assert abs(dest.stat().st_mtime - orig_mtime) < 2   # 恢复到原 mtime（非"刚刚"）
    # 端到端：立刻挪回原项目，不再被活动守卫拦截
    assert move_session(sid, str(src_proj), projects)["ok"] is True
    assert (projects / munge_path(src_proj) / f"{sid}.jsonl").is_file()

def test_move_session_active_guard(tmp_path):
    """活动会话（ACTIVE_WINDOW_SECONDS 内还在写）拒绝移动；转为老文件后放行。"""
    import os
    import time
    src_proj = tmp_path / "源"
    src_proj.mkdir()
    dst_proj = tmp_path / "目标"
    dst_proj.mkdir()
    projects = tmp_path / "projects"
    sid = "act111"
    p = _write_session_with_cwd(projects, munge_path(src_proj), sid, str(src_proj))
    now = time.time()
    os.utime(p, (now, now))
    r = move_session(sid, str(dst_proj), projects)
    assert r == {"ok": False, "error": "会话仍在活动中，请稍后再移动"}
    os.utime(p, (now - 10000, now - 10000))
    assert move_session(sid, str(dst_proj), projects)["ok"] is True

def test_rename_first_line_byte_compatible_with_claude(fixture_projects_dir, make_session_file):
    """写后首行与 Claude Code 原生格式逐字节兼容：
    键序 type/customTitle/sessionId、ensure_ascii=False（中文原样无 \\u 转义）、\\n 换行。"""
    p = make_session_file(fixture_projects_dir, "C--Users-20714", "com111",
                          "2026-08-01T10:00:00+00:00", "首条消息")
    rename_session("com111", "测试标题ABC", fixture_projects_dir)
    head = p.read_bytes().split(b"\n", 1)[0]
    assert head == json.dumps({"type": "custom-title", "customTitle": "测试标题ABC",
                               "sessionId": "com111"}, ensure_ascii=False).encode("utf-8")
    assert "测试标题ABC".encode("utf-8") in head      # 中文原样
    assert b"\\u" not in head                          # 无 ensure_ascii 转义
    assert head.index(b'"type"') < head.index(b"customTitle") < head.index(b"sessionId")

# ---- 分叉族检测 ----

def _write_fork_session(projects_dir, slug, sid, user_uuid, ts_iso, user_text, bg=False):
    """写一个带 uuid 的会话文件（分叉族检测依赖首条 user 记录的 uuid）。

    bg=True 模拟分叉会话：复制的记录带 sessionKind="bg"（Claude Code 分叉
    产物的标志，原始会话的记录没有）。
    """
    p = Path(projects_dir) / slug / f"{sid}.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {"type": "user", "uuid": user_uuid, "timestamp": ts_iso,
           "message": {"role": "user", "content": user_text}}
    if bg:
        rec["sessionKind"] = "bg"
    with p.open("w", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        f.write(json.dumps({"type": "assistant", "timestamp": ts_iso,
                            "message": {"role": "assistant", "content": "ok"}}) + "\n")
    return p

def test_fork_family_marked(fixture_projects_dir):
    """同一项目内首条 user 记录 uuid 相同的会话为同源分叉族（Claude 复制消息链
    另建文件，uuid 原样保留）：族内带 sessionKind=bg 的为分叉副本，标记 forked；
    uuid 不同或跨项目的会话不组族。bg 判定优先于创建时间（st_ctime 在同一
    微秒内相同，实测不可靠）。"""
    slug = "D--Count-Obsidian-main-project-007"
    _write_fork_session(fixture_projects_dir, slug, "orig111", "uuid-src",
                        "2026-08-06T10:00:00+00:00", "同一句话")           # 原始：无 bg
    _write_fork_session(fixture_projects_dir, slug, "fork222", "uuid-src",
                        "2026-08-06T10:00:00+00:00", "同一句话", bg=True)  # 分叉：带 bg
    _write_fork_session(fixture_projects_dir, slug, "other333", "uuid-other",
                        "2026-08-06T11:00:00+00:00", "别的对话")
    _write_fork_session(fixture_projects_dir, "D--Count-Obsidian-main-project-002", "other-slug", "uuid-src",
                        "2026-08-06T12:00:00+00:00", "同一句话")
    sessions = list_sessions(fixture_projects_dir)
    by_id = {s.id: s for s in sessions}
    assert by_id["orig111"].forked is False      # 原始会话不标记
    assert by_id["fork222"].forked is True       # 带 bg 标志 = 分叉副本
    assert by_id["other333"].forked is False     # 不同 uuid 不标记
    assert by_id["other-slug"].forked is False   # 跨项目不组族

def test_fork_family_bg_priority_over_ctime(fixture_projects_dir):
    """bg 判定优先于创建时间：即使分叉文件创建时间更早（创建时间粒度不可靠），
    带 bg 标志的仍是分叉副本。"""
    slug = "D--Count-Obsidian-main-project-007"
    _write_fork_session(fixture_projects_dir, slug, "fork-first", "uuid-bg",
                        "2026-08-06T10:00:00+00:00", "同一句话", bg=True)
    _write_fork_session(fixture_projects_dir, slug, "orig-later", "uuid-bg",
                        "2026-08-06T10:00:00+00:00", "同一句话")
    sessions = list_sessions(fixture_projects_dir)
    by_id = {s.id: s for s in sessions}
    assert by_id["fork-first"].forked is True    # 带 bg = 分叉，与创建顺序无关
    assert by_id["orig-later"].forked is False

def test_fork_empty_session_not_marked(fixture_projects_dir):
    """无 user 记录的会话（如中断的空分叉）没有分叉键，不参与标记；
    预览兜底 (无文本消息)。"""
    slug = "D--Count-Obsidian-main-project-007"
    _write_fork_session(fixture_projects_dir, slug, "a111", "uuid-src",
                        "2026-08-06T10:00:00+00:00", "同一句话")
    p = Path(fixture_projects_dir) / slug / "empty999.jsonl"
    p.write_text(json.dumps({"type": "ai-title", "aiTitle": "x"}, ensure_ascii=False) + "\n",
                 encoding="utf-8")
    sessions = list_sessions(fixture_projects_dir)
    by_id = {s.id: s for s in sessions}
    assert by_id["empty999"].preview == "(无文本消息)"
    assert by_id["empty999"].first_user_uuid is None
    assert by_id["empty999"].forked is False
    assert by_id["a111"].forked is False         # 族内只有自己，不算分叉
