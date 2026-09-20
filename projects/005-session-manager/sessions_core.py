"""会话管家纯逻辑层：扫描/解析/分组/统计/搜索/回收站。GUI 与 CLI 共用。"""
from __future__ import annotations
import json, os, re, shutil, sys, time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_PROJECTS_DIR = Path.home() / ".claude" / "projects"
DEFAULT_TRASH_DIR = Path.home() / ".claude" / "session_trash"
DEFAULT_CODEX_SESSIONS_DIR = Path.home() / ".codex" / "sessions"
DEFAULT_CODEX_ARCHIVED_DIR = Path.home() / ".codex" / "archived_sessions"
ACTIVE_WINDOW_SECONDS = 600

_MAX_TITLE_LEN = 100

@dataclass
class Session:
    id: str
    project: str
    when: str
    size_kb: int
    preview: str
    active: bool
    ts: float
    title: str | None = None   # 会话显示名：转录首行 custom-title 记录的 customTitle
    first_user_uuid: str | None = None   # 文件内首条 user 记录的 uuid（分叉族识别键）
    first_bg: bool = False     # 首条 user 记录带 sessionKind=bg（分叉会话的标志）
    created_ts: float = 0.0    # 文件创建时间（Windows st_ctime），分叉族排序兜底
    forked: bool = False       # 同项目内同源分叉族中的副本（带 bg 标志或晚创建）
    source_tool: str = "claude"  # claude / codex；Codex 搜索结果只读
    readonly: bool = False
    archived: bool = False
    match_preview: str | None = None

def munge_path(path: str | Path) -> str:
    """把真实路径变换为 Claude Code slug 形式（确定性、有损：非 [A-Za-z0-9] → '-'）。"""
    return re.sub(r"[^A-Za-z0-9]", "-", str(path))

def friendly_name(slug: str) -> str:
    # 规则顺序（合并分组按 friendly 归并，误并会把两个真实项目静默合为一组）：
    # 1) C--Users- 前缀 → Home：用户明确要的 home 子目录归并，保留在最前；
    # 2) project 提取只对 vault 根前缀（D--Count-Obsidian-main-）门控生效——
    #    机器上若存在 vault 外的同名 project 目录（克隆/备份/另一盘），其 slug
    #    也会匹配 project-NNN 提取出相同 friendly，合并分组后 count/排序混算、
    #    source 错位；门控后这类 slug 返回原样、保持独立组；
    # 3) 其余 slug 返回原样。
    if slug.startswith("C--Users-"):
        return "Home"
    if slug.startswith("D--Count-Obsidian-main-"):
        m = re.search(r"project[-_](\d+)(.*)$", slug)
        if m:
            tail = re.sub(r"-+", " ", m.group(2)).strip()
            return "project_" + m.group(1) + (f" {tail}" if tail else "")
    return slug

def _first_user_message(path: Path) -> str:
    try:
        with path.open(encoding="utf-8", errors="replace") as h:
            for line in h:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(e, dict):   # 合法 JSON 但非 dict 的行直接跳过
                    continue
                if e.get("type") != "user":
                    continue
                c = e.get("message", {}).get("content")
                if isinstance(c, str) and c.strip():
                    return " ".join(c.split())[:100]
                if isinstance(c, list):
                    for b in c:
                        if isinstance(b, dict) and b.get("type") == "text" and str(b.get("text", "")).strip():
                            return " ".join(str(b["text"]).split())[:100]
    except OSError:
        pass
    return "(无文本消息)"

def _first_timestamp(path: Path) -> float:
    try:
        with path.open(encoding="utf-8", errors="replace") as h:
            for line in h:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(e, dict):   # 合法 JSON 但非 dict 的行直接跳过
                    continue
                ts = e.get("timestamp")
                if not ts:
                    continue
                if isinstance(ts, (int, float)):
                    return ts
                try:
                    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
                except ValueError:
                    continue
    except OSError:
        pass
    return path.stat().st_mtime

def _first_user_record(path: Path) -> tuple[str, str | None, bool]:
    """返回 (预览文本, 首条 user 记录 uuid, 首条记录是否 sessionKind=bg)。

    预览与 _first_user_message 语义一致：取首条带文本的 user 消息（跳过
    tool_result 等无文本记录）；uuid 取文件内第一条 user 记录的 uuid——Claude
    Code 分叉会话时原样复制消息链（uuid 不变），同项目内首条 user uuid 相同的
    多个会话即为同源分叉族。bg 标志：分叉会话以后台方式写入，其（复制的）
    记录带 sessionKind="bg"，而原始会话的记录没有——用它判定族内谁是分叉
    （文件创建时间 st_ctime 在同一微秒内相同，实测不可靠，仅作兜底）。
    解析失败返回 (无文本消息, None, False)。
    """
    first_uuid: str | None = None
    first_bg = False
    try:
        with path.open(encoding="utf-8", errors="replace") as h:
            for line in h:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(e, dict) or e.get("type") != "user":
                    continue
                if first_uuid is None and isinstance(e.get("uuid"), str):
                    first_uuid = e["uuid"]
                    first_bg = e.get("sessionKind") == "bg"
                c = e.get("message", {}).get("content")
                text = ""
                if isinstance(c, str) and c.strip():
                    text = " ".join(c.split())[:100]
                elif isinstance(c, list):
                    for b in c:
                        if isinstance(b, dict) and b.get("type") == "text" and str(b.get("text", "")).strip():
                            text = " ".join(str(b["text"]).split())[:100]
                            break
                if text:
                    return text, first_uuid, first_bg
    except OSError:
        pass
    return "(无文本消息)", first_uuid, first_bg

def _first_title(path: Path) -> str | None:
    """读取转录首条记录的 customTitle；首行解析失败/非 dict/非 custom-title 一律
    视为无标题（跳过）返回 None，不抛出（容错口径与 _first_timestamp 一致）。"""
    try:
        with path.open(encoding="utf-8", errors="replace") as h:
            for line in h:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    return None
                if not isinstance(e, dict):
                    return None
                if e.get("type") == "custom-title":
                    t = e.get("customTitle")
                    return t if isinstance(t, str) and t.strip() else None
                return None
    except OSError:
        return None
    return None

def list_sessions(projects_dir: Path = DEFAULT_PROJECTS_DIR, exclude: str | None = None) -> list[Session]:
    sessions: list[Session] = []
    for path in sorted(projects_dir.glob("*/*.jsonl")):
        if path.name.startswith("."):
            continue
        sid = path.stem
        if exclude and sid == exclude:
            continue
        ts = _first_timestamp(path)
        preview, first_uuid, first_bg = _first_user_record(path)
        sessions.append(Session(
            id=sid,
            project=path.parent.name,
            when=datetime.fromtimestamp(ts, timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M"),
            size_kb=(path.stat().st_size + 1023) // 1024,
            preview=preview,
            active=(time.time() - path.stat().st_mtime) < ACTIVE_WINDOW_SECONDS,
            ts=ts,
            title=_first_title(path),
            first_user_uuid=first_uuid,
            first_bg=first_bg,
            created_ts=path.stat().st_ctime,
        ))

    # 分叉族检测：Claude Code 对正在运行的会话再次 --resume 时会复制消息链
    # （uuid 原样保留、记录打上 sessionKind=bg）另建新文件，导致同项目内出现
    # "两个相同对话"。同一项目内首条 user 记录 uuid 相同的会话视为同源分叉族；
    # 族内带 bg 标志的是分叉副本（原始会话的记录无该标志），标记 forked；
    # 全部无 bg 时按创建时间兜底（st_ctime 同一微秒内会相同，仅作近似）。
    # uuid 相同但项目不同不算（副本不受跨项目影响；移动过分叉会拆散族，
    # 属可接受的近似）。空会话（无 user 记录）不参与。
    families: dict[tuple[str, str], list[Session]] = {}
    for s in sessions:
        if s.first_user_uuid:
            families.setdefault((s.project, s.first_user_uuid), []).append(s)
    for family in families.values():
        if len(family) < 2:
            continue
        family.sort(key=lambda s: (s.first_bg, s.created_ts, s.id))   # 非 bg 原始会话在前
        for s in family[1:]:
            s.forked = True

    sessions.sort(key=lambda s: s.ts, reverse=True)
    return sessions

def group_by_project(sessions: list[Session]) -> list[dict[str, Any]]:
    """按显示名（friendly_name）分组：friendly 相同的会话合并为一组（如多个
    C--Users-20714-* slug 都显示为 Home，不再各占一组）。组内按时间倒序；
    组间仍按组内最近会话时间倒序；count/size_kb 按合并后求和。

    注意：group["project"] 现在是合并键（显示名，如 "Home"），不再是单一 slug——
    删除/进入依赖的 slug 保留在会话级字段 s.project（Session.project 不变）。
    """
    by_friendly: dict[tuple[str, str], list[Session]] = {}
    labels: dict[tuple[str, str], str] = {}
    for s in sessions:
        if s.source_tool == "codex":
            project_path = Path(s.project)
            leaf = project_path.name or s.project or "未知目录"
            label = f"Codex · {leaf}"
            key = ("codex", os.path.normcase(s.project))
        else:
            label = friendly_name(s.project)
            key = ("claude", label)
        labels[key] = label
        by_friendly.setdefault(key, []).append(s)
    groups = []
    for key, items in by_friendly.items():
        friendly = labels[key]
        items.sort(key=lambda s: s.ts, reverse=True)   # 合并后组内显式保持时间倒序
        groups.append({
            "project": friendly,          # 合并键 = 显示名；slug 见各 s.project
            "friendly": friendly,
            "count": len(items),
            "size_kb": sum(i.size_kb for i in items),
            "sessions": items,
        })
    groups.sort(key=lambda g: max(s.ts for s in g["sessions"]), reverse=True)
    return groups

def _message_texts(record: Any, source_tool: str) -> list[str]:
    """只提取用户/助手正文，不把工具参数、系统指令或元数据纳入全文索引。"""
    if not isinstance(record, dict):
        return []
    message: Any = None
    if source_tool == "claude" and record.get("type") in {"user", "assistant"}:
        message = record.get("message")
    elif source_tool == "codex":
        payload = record.get("payload")
        if not isinstance(payload, dict):
            return []
        if record.get("type") == "response_item" and payload.get("type") == "message" \
                and payload.get("role") in {"user", "assistant"}:
            message = payload
        elif record.get("type") == "event_msg" and payload.get("type") in {"user_message", "agent_message"}:
            value = payload.get("message")
            return [value] if isinstance(value, str) and value.strip() else []
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    if isinstance(content, str):
        return [content] if content.strip() else []
    if not isinstance(content, list):
        return []
    texts = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") not in {None, "text", "input_text", "output_text"}:
            continue
        text = block.get("text")
        if isinstance(text, str) and text.strip():
            texts.append(text)
    return texts


def _excerpt(text: str, query: str, limit: int = 180) -> str:
    compact = " ".join(text.split())
    folded = compact.casefold()
    at = folded.find(query)
    if at < 0:
        return compact[:limit]
    start = max(0, at - limit // 3)
    end = min(len(compact), start + limit)
    return ("…" if start else "") + compact[start:end] + ("…" if end < len(compact) else "")


_TRANSCRIPT_CACHE: dict[tuple[str, str], tuple[int, int, dict[str, Any]]] = {}


def _transcript_index(path: Path, source_tool: str) -> dict[str, Any] | None:
    """按 mtime/size 缓存正文索引；只驻留当前进程，不复制到数据库或日志。"""
    try:
        stat = path.stat()
    except OSError:
        return None
    key = (source_tool, str(path))
    signature = (stat.st_mtime_ns, stat.st_size)
    cached = _TRANSCRIPT_CACHE.get(key)
    if cached is not None and cached[:2] == signature:
        return cached[2]
    index: dict[str, Any] = {
        "texts": [], "folded": [], "first_user": "", "session_id": "",
        "cwd": "", "timestamp": None,
    }
    try:
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(record, dict):
                    continue
                if index["timestamp"] is None:
                    index["timestamp"] = record.get("timestamp")
                if source_tool == "codex" and record.get("type") == "session_meta" \
                        and isinstance(record.get("payload"), dict):
                    payload = record["payload"]
                    index["session_id"] = str(payload.get("id") or payload.get("session_id") or "")
                    index["cwd"] = str(payload.get("cwd") or "")
                    index["timestamp"] = payload.get("timestamp") or index["timestamp"]
                texts = _message_texts(record, source_tool)
                if not texts:
                    continue
                if not index["first_user"]:
                    if source_tool == "claude":
                        is_user = record.get("type") == "user"
                    else:
                        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
                        is_user = (record.get("type") == "event_msg" and payload.get("type") == "user_message") \
                            or (record.get("type") == "response_item" and payload.get("role") == "user")
                    if is_user:
                        index["first_user"] = " ".join(texts[0].split())[:100]
                index["texts"].extend(texts)
                index["folded"].extend(text.casefold() for text in texts)
    except OSError:
        return None
    _TRANSCRIPT_CACHE[key] = (signature[0], signature[1], index)
    return index


def _transcript_match(path: Path, query: str, source_tool: str) -> str | None:
    index = _transcript_index(path, source_tool)
    if index is None:
        return None
    for text, folded in zip(index["texts"], index["folded"]):
        if query in folded:
            return _excerpt(text, query)
    return None


def search(q: str, projects_dir: Path = DEFAULT_PROJECTS_DIR) -> list[dict[str, Any]]:
    """Claude 本地全文搜索；保留原分组合同，供 CLI 与旧调用方使用。"""
    query = q.strip().casefold()
    if not query:
        return group_by_project(list_sessions(projects_dir))
    hits: list[Session] = []
    for session in list_sessions(projects_dir):
        metadata_hit = ((session.title and query in session.title.casefold())
                        or query in session.preview.casefold()
                        or query in session.project.casefold()
                        or query in friendly_name(session.project).casefold())
        transcript_path = projects_dir / session.project / f"{session.id}.jsonl"
        match = None if metadata_hit else _transcript_match(transcript_path, query, "claude")
        if metadata_hit or match:
            hits.append(replace(session, preview=match or session.preview, match_preview=match))
    return group_by_project(hits)


def _parse_time(value: Any, fallback: float) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
    return fallback


def _codex_session(path: Path, query: str, archived: bool) -> Session | None:
    """解析一个 Codex rollout；只读，不暴露转录文件路径或系统指令。"""
    try:
        stat = path.stat()
    except OSError:
        return None
    index = _transcript_index(path, "codex")
    if index is None:
        return None
    session_id = index["session_id"]
    cwd = index["cwd"]
    first_timestamp = index["timestamp"]
    first_user = index["first_user"]
    match = None
    for text, folded in zip(index["texts"], index["folded"]):
        if query in folded:
            match = _excerpt(text, query)
            break
    if not session_id:
        uuid_match = re.search(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", path.stem)
        session_id = uuid_match.group(0) if uuid_match else path.stem
    metadata_hit = query in session_id.casefold() or (cwd and query in cwd.casefold())
    if match is None and not metadata_hit:
        return None
    ts = _parse_time(first_timestamp, stat.st_mtime)
    return Session(
        id=session_id,
        project=cwd or "未知目录",
        when=datetime.fromtimestamp(ts, timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M"),
        size_kb=(stat.st_size + 1023) // 1024,
        preview=match or first_user or "(无文本消息)",
        active=not archived and (time.time() - stat.st_mtime) < ACTIVE_WINDOW_SECONDS,
        ts=ts,
        source_tool="codex",
        readonly=True,
        archived=archived,
        match_preview=match,
    )


def search_all(q: str, projects_dir: Path = DEFAULT_PROJECTS_DIR,
               codex_sessions_dir: Path = DEFAULT_CODEX_SESSIONS_DIR,
               codex_archived_dir: Path = DEFAULT_CODEX_ARCHIVED_DIR) -> list[dict[str, Any]]:
    """跨 Claude/Codex 的本地全文搜索；Codex 结果为只读。"""
    query = q.strip().casefold()
    if not query:
        return group_by_project(list_sessions(projects_dir))
    sessions = [s for group in search(q, projects_dir) for s in group["sessions"]]
    for root, archived in ((codex_sessions_dir, False), (codex_archived_dir, True)):
        if not root.is_dir():
            continue
        for path in root.rglob("*.jsonl"):
            session = _codex_session(path, query, archived)
            if session is not None:
                sessions.append(session)
    return group_by_project(sessions)

def rename_session(session_id: str, title: str | None,
                   projects_dir: Path = DEFAULT_PROJECTS_DIR) -> dict:
    """设置会话显示标题：写入转录文件首行 custom-title 记录。

    格式与 Claude Code 原生逐字节兼容：键序 type/customTitle/sessionId、
    ensure_ascii=False（中文原样）、\n 换行。title 留空/全空白不改（留空=不改）；
    超 _MAX_TITLE_LEN 字符拒绝。写盘走同目录临时文件 + os.replace 原子替换，
    任何失败路径都不得留下半截文件。
    """
    if not isinstance(title, str) or not title.strip():
        return {"ok": False, "error": "标题为空，未修改"}
    title = title.strip()
    if len(title) > _MAX_TITLE_LEN:
        return {"ok": False, "error": f"标题过长（最多 {_MAX_TITLE_LEN} 字符）"}
    path = None
    if projects_dir.is_dir():
        for d in projects_dir.iterdir():
            if not d.is_dir():
                continue
            cand = d / f"{session_id}.jsonl"
            if cand.is_file():
                path = cand
                break
    if path is None:
        return {"ok": False, "error": "未找到会话"}
    try:
        data = path.read_bytes()
    except OSError as e:
        return {"ok": False, "error": f"读取失败：{e}"}
    nl = data.find(b"\n")
    if nl == -1:
        first_line, rest = data, b""
    else:
        first_line, rest = data[:nl], data[nl + 1:]
    record = None
    try:
        e = json.loads(first_line.decode("utf-8"))
        if isinstance(e, dict) and e.get("type") == "custom-title":
            record = e
    except (json.JSONDecodeError, UnicodeDecodeError):
        record = None
    if record is not None:
        record["customTitle"] = title   # 原地更新，保持原有键序
        new_first = json.dumps(record, ensure_ascii=False).encode("utf-8")
    else:
        new_first = json.dumps({"type": "custom-title", "customTitle": title,
                                "sessionId": session_id}, ensure_ascii=False).encode("utf-8")
    tmp = path.with_name(path.name + ".tmp-rename")
    try:
        tmp.write_bytes(new_first + b"\n" + rest)
        os.replace(tmp, path)
    except OSError as e:
        try:
            tmp.unlink()
        except OSError:
            pass
        return {"ok": False, "error": f"写入失败：{e}"}
    return {"ok": True, "title": title}

def _trash_summary(trash_dir: Path) -> tuple[int, int]:
    count = size = 0
    if not trash_dir.is_dir():
        return 0, 0
    for folder in trash_dir.iterdir():
        if not folder.is_dir():
            continue
        for f in folder.iterdir():
            if f.suffix == ".jsonl":
                count += 1
                # 向上取整，与 list_sessions 的 size_kb 口径一致（亚 KB 文件计 1KB）
                size += (f.stat().st_size + 1023) // 1024
    return count, size

def stats(projects_dir: Path = DEFAULT_PROJECTS_DIR, trash_dir: Path = DEFAULT_TRASH_DIR) -> dict[str, Any]:
    sessions = list_sessions(projects_dir)
    per = [{"project": g["project"], "friendly": g["friendly"], "count": g["count"], "size_kb": g["size_kb"]}
           for g in group_by_project(sessions)]
    t_count, t_size = _trash_summary(trash_dir)
    return {
        "total": len(sessions),
        "total_size_kb": sum(g["size_kb"] for g in per),
        "per_project": per,
        "trash_count": t_count,
        "trash_size_kb": t_size,
    }

def list_trash(trash_dir: Path = DEFAULT_TRASH_DIR) -> list[dict[str, Any]]:
    out = []
    if not trash_dir.is_dir():
        return out
    for folder in sorted(trash_dir.iterdir()):
        if not folder.is_dir():
            continue
        for f in folder.iterdir():
            if f.suffix != ".jsonl":
                continue
            out.append({
                "id": f.stem,
                "when": datetime.fromtimestamp(_first_timestamp(f), timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M"),
                "project": f.parent.name,
                "size_kb": (f.stat().st_size + 1023) // 1024,  # 向上取整，与 list_sessions/stats 口径一致（亚 KB 文件计 1KB）
                "preview": _first_user_message(f),
            })
    out.sort(key=lambda t: t["when"], reverse=True)
    return out

def delete_sessions(ids: list[str], projects_dir: Path = DEFAULT_PROJECTS_DIR,
                    trash_dir: Path = DEFAULT_TRASH_DIR) -> dict[str, str]:
    result = {}
    sessions = {s.id: s for s in list_sessions(projects_dir)}
    for sid in ids:
        s = sessions.get(sid)
        if s is None:
            result[sid] = "未找到"
            continue
        target = trash_dir / f"{s.ts:.0f}_{s.project}_{s.id}"
        try:
            target.mkdir(parents=True, exist_ok=True)
            srcs = [projects_dir / s.project / f"{s.id}.jsonl"]
            folder = projects_dir / s.project / s.id
            if folder.is_dir():
                srcs.append(folder)
            for src in srcs:
                shutil.move(str(src), str(target / src.name))
            result[sid] = "已移入回收站"
        except OSError as e:
            result[sid] = f"失败：{e}"
    return result

def restore_sessions(ids: list[str], trash_dir: Path = DEFAULT_TRASH_DIR,
                     projects_dir: Path = DEFAULT_PROJECTS_DIR) -> int:
    """按 id 前缀恢复回收站会话；返回成功恢复数，有失败时返回负数（失败数）。"""
    moved = 0
    failed = 0
    if not trash_dir.is_dir():
        return 0
    for folder in list(trash_dir.iterdir()):
        if not folder.is_dir():
            continue
        for f in list(folder.iterdir()):
            if f.suffix != ".jsonl":
                continue
            if any(f.stem.startswith(i) for i in ids):
                dest_dir = projects_dir / folder.name.split("_", 2)[1]
                dest = dest_dir / f.name
                # 目标已存在（如该会话被重新创建）：不覆盖活动会话，按失败处理
                if dest.exists():
                    failed += 1
                    continue
                try:
                    dest_dir.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(f), str(dest))
                    # delete 时同名 sidecar 目录（含 subagents/）随 jsonl 一并移入 trash，
                    # restore 时必须一并归位，否则 purge 会将其物理删除（数据丢失）。
                    sidecar = folder / f.stem
                    if sidecar.is_dir():
                        shutil.move(str(sidecar), str(dest_dir / f.stem))
                    moved += 1
                except OSError as e:
                    failed += 1
    return -failed if failed else moved

def move_session(session_id: str, target_path: str,
                 projects_dir: Path = DEFAULT_PROJECTS_DIR) -> dict:
    """把会话移动到另一项目目录：改写转录 cwd 记录后迁移 jsonl（+sidecar）。

    移动后会话完全归属新项目：全部 cwd 记录改写为目标目录（与 claude --resume
    的项目作用域一致，见 app._recorded_project_cwds 的 slug 匹配），文件从
    projects/<旧slug>/ 迁到 projects/<新slug>/。任何失败路径都不改动原文件；
    活动会话（ACTIVE_WINDOW_SECONDS 内还在写）拒绝移动，避免打断运行中的对话。
    """
    if not target_path or not os.path.isdir(target_path):
        return {"ok": False, "error": "目标项目路径不存在或不是文件夹"}
    src_dir = None
    if projects_dir.is_dir():
        for d in projects_dir.iterdir():
            if d.is_dir() and (d / f"{session_id}.jsonl").is_file():
                src_dir = d
                break
    if src_dir is None:
        return {"ok": False, "error": "未找到会话"}
    target_slug = munge_path(target_path)
    if target_slug == src_dir.name:
        return {"ok": False, "error": "该会话已在同一项目"}
    src = src_dir / f"{session_id}.jsonl"
    if (time.time() - src.stat().st_mtime) < ACTIVE_WINDOW_SECONDS:
        return {"ok": False, "error": "会话仍在活动中，请稍后再移动"}
    dest_dir = projects_dir / target_slug
    dest = dest_dir / f"{session_id}.jsonl"
    if dest.exists():
        return {"ok": False, "error": "目标项目已存在同名会话"}

    # 改写 cwd：逐行解析后整行重写；无 cwd / 非 dict 的行逐字节保留；任何一行
    # 解析失败都中止（宁可不动原文件，不丢字节），成功写入走原子替换。
    new_cwd = os.path.normpath(target_path)
    try:
        data = src.read_bytes()
        st = src.stat()   # 记下原 atime/mtime：迁移后恢复，避免移动本身把会话
                          # 变成"刚刚活动"（否则 10 分钟内无法再次移动/挪回）
    except OSError as e:
        return {"ok": False, "error": f"读取失败：{e}"}
    out_lines: list[bytes] = []
    for line in data.split(b"\n"):
        if not line:
            out_lines.append(line)
            continue
        try:
            e = json.loads(line.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {"ok": False, "error": "转录存在无法解析的记录，已取消移动"}
        if not isinstance(e, dict) or not isinstance(e.get("cwd"), str):
            out_lines.append(line)
            continue
        e["cwd"] = new_cwd
        out_lines.append(json.dumps(e, ensure_ascii=False).encode("utf-8"))
    try:
        tmp = src.with_name(src.name + ".tmp-move")
        tmp.write_bytes(b"\n".join(out_lines))
        os.replace(tmp, src)
    except OSError as e:
        try:
            tmp.unlink()
        except OSError:
            pass
        return {"ok": False, "error": f"写入失败：{e}"}

    # 先迁 jsonl（关键文件），再迁 sidecar（subagents 等）；sidecar 失败回滚 jsonl
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
    except OSError as e:
        return {"ok": False, "error": f"移动失败：{e}"}
    try:
        # 恢复原 mtime：改写+迁移让文件看起来"刚刚活动"，活动守卫（10 分钟窗口）
        # 会把刚移动的会话误判为运行中，导致无法立即再移动/挪回；恢复后守卫
        # 仍按真实写入时间判定（真正运行中的会话 mtime 会不断更新）。
        os.utime(dest, (st.st_atime, st.st_mtime))
    except OSError:
        pass   # best-effort：恢复失败不影响移动结果
    sidecar = src_dir / session_id
    if sidecar.is_dir():
        try:
            shutil.move(str(sidecar), str(dest_dir / session_id))
        except OSError as e:
            try:
                shutil.move(str(dest), str(src))
            except OSError:
                pass
            return {"ok": False, "error": f"移动会话数据失败：{e}"}
    return {"ok": True, "error": None}

def purge_trash(trash_dir: Path = DEFAULT_TRASH_DIR) -> int:
    if not trash_dir.is_dir():
        return 0
    n = sum(1 for d in trash_dir.iterdir() if d.is_dir())
    shutil.rmtree(trash_dir)
    return n

# ===== 跨实例互斥锁（2026-08-08）=====
# 双会话管家实例并发点同一会话「进入」时，5 秒冷却（单实例内存态）与进程扫描
# （claude 进程尚未启动时不可见）都拦不住——用「独占创建锁文件」实现跨进程互斥：
# 文件存在 = 锁被占用；锁内记录持有者 PID，持有者已死则为残留锁，可安全清理。
# 思想 ≈ OS 信号量（PV）的落地变体：二值、非阻塞（拿不到即拒绝，不排队）、
# 文件系统载体跨进程有效（术语卡片 2026-08-08）。

_ENTER_LOCK_SUFFIX = ".enter.lock"


def _pid_alive(pid: int) -> bool:
    """无依赖进程存活检查：Windows 用 OpenProcess 查询；非 Windows 回退 os.kill(pid, 0)。

    任何异常保守返回 False（按「进程不存在」处理，允许清理残留锁）。
    """
    try:
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        ctypes.windll.kernel32.CloseHandle(h)
        return True
    except Exception:  # noqa: BLE001
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def acquire_enter_lock(lock_path: Path, pid: int | None = None) -> tuple[bool, str | None]:
    """跨实例互斥：独占创建锁文件，成功返回 (True, None)。

    - 锁文件存在且持有者存活 → (False, 拒绝原因)：另一实例正在进入。
    - 残留锁（持有者已死 / 内容损坏）→ 自动清理并重试一次（自愈）。
    - 注：残留清理存在极小 unlink 竞态（两实例同时清同一残留锁），后果只是
      退回未加锁的竞态，与加锁前等价，不引入新风险。
    """
    holder = pid or os.getpid()
    for _attempt in range(2):
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            holder_pid = -1
            try:
                data = json.loads(lock_path.read_text(encoding="utf-8"))
                holder_pid = int(data.get("pid", -1))
            except Exception:  # noqa: BLE001 - 解析失败按残留清理
                pass
            if holder_pid > 0 and _pid_alive(holder_pid):
                return False, "另一实例正在进入该会话，已停止启动（锁持有者存活）"
            try:
                lock_path.unlink()
                continue  # 残留已清理，重试创建
            except OSError:
                return False, "锁文件清理失败，请稍后重试"
        except OSError:
            return False, "锁文件创建失败，请稍后重试"
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"pid": holder, "ts": time.time()}, fh)
        return True, None
    return False, "另一实例正在进入该会话，已停止启动（锁持有者存活）"


def release_enter_lock(lock_path: Path) -> None:
    """释放锁（文件不存在时静默，无需调用方判存在）。"""
    try:
        lock_path.unlink()
    except OSError:
        pass
