"""会话管家 GUI 入口：pywebview 窗口 + js_api 桥接。"""
from __future__ import annotations
import json, os, re, shutil, subprocess, sys, threading, time
from pathlib import Path
from typing import Any
import sessions_core as core

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).parent
# close_after_enter 为 Task 9 新增字段（设置页「会话进入后关闭本窗口」开关），
# set_settings 是合并语义，新字段必须在 DEFAULT_SETTINGS 登记才能持久化。
DEFAULT_SETTINGS = {"dark": False, "confirm_delete": True, "claude_path": "", "close_after_enter": False}
# 项目（Codex 式）列表与 settings 同目录；结构 [{"name": str, "path": str}, ...]
DEFAULT_PROJECTS_FILE = Path.home() / ".claude" / "session_manager_projects.json"
# enter() 防重复进入冷却窗口：同一会话在此秒数内只允许启动一次 claude（见 enter 说明）
_ENTER_COOLDOWN_SECONDS = 5.0

def _claude_env() -> dict:
    """净化子进程环境（enter / start_project_session 共用）。

    exe 继承自启动它的父进程（本机 Claude Code 会话里有
    CLAUDE_CODE_CHILD_SESSION=1），不清理的话 claude 会把 GUI 恢复/新建的会话
    误判为子会话并关闭转录保存。用户从 GUI 进入的是真实会话，必须保存转录，
    故移除该标记并显式强制会话持久化。
    """
    env = dict(os.environ)
    env.pop("CLAUDE_CODE_CHILD_SESSION", None)
    env["CLAUDE_CODE_FORCE_SESSION_PERSISTENCE"] = "1"
    return env

def resource_path(rel: str) -> Path:
    base = getattr(sys, "_MEIPASS", BASE_DIR)
    return Path(base) / rel

def _session_to_dict(s) -> dict[str, Any]:
    return {"id": s.id, "project": s.project, "when": s.when,
            "size_kb": s.size_kb, "preview": s.preview, "active": s.active,
            "title": s.title, "forked": s.forked,
            "source_tool": s.source_tool, "readonly": s.readonly,
            "archived": s.archived, "match_preview": s.match_preview}

def session_live_pids(session_id: str) -> list[str]:
    """扫描 claude.exe 存活进程的命令行，返回以该会话为**本体**的 PID 列表。

    匹配形态（实测 2026-08-06，claude 2.1.223）：
    - 会话本体：  --session-id <id>          （窗口关闭后 daemon 后台作业仍存活）
    - 恢复请求：  --resume <id> / --resume=<id>
    只匹配独立参数 == id：分叉进程命令行的 `--resume <源jsonl路径>`（路径内含
    源 id）不匹配——源会话进程已死时允许重新进入，避免误拦。
    查询用 PowerShell CIM（wmic 已弃用）；失败返回 []（不阻塞进入，
    由 mtime 活动检测兜底）。
    """
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | "
             "ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"],
            text=True, errors="replace", timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception:   # noqa: BLE001 - 进程扫描是 best-effort：任何失败（无权限/超时/
                        # 被测试 mock 的 Popen）都返回 []，由 mtime 活动检测兜底
        return []
    pids = []
    for line in out.splitlines():
        pid, sep, cmd = line.partition("|")
        if not sep:
            continue
        args = cmd.split()
        for i, arg in enumerate(args):
            if arg in ("--session-id", "--resume"):
                if i + 1 < len(args) and args[i + 1].strip('"') == session_id:
                    pids.append(pid)
                    break
            elif arg.startswith(("--session-id=", "--resume=")):
                if arg.split("=", 1)[1].strip('"') == session_id:
                    pids.append(pid)
                    break
    return pids

def _parse_proc_lines(text: str) -> list[dict[str, Any]]:
    """解析 PowerShell CIM 输出的 `pid|cmdline` 行。返回 [{pid, cmd, session_id,
    is_fork, is_pty, is_daemon}]。

    session_id 提取：--session-id 参数，或 --bg-pty-host 管道名里的
    `-pty-<uuid>`（pty-host 进程不自带 --session-id，管道名含其服务的会话）。
    """
    procs: list[dict[str, Any]] = []
    for line in text.splitlines():
        pid, sep, cmd = line.partition("|")
        if not sep or not pid.isdigit():
            continue
        p = {"pid": pid, "cmd": cmd, "session_id": None,
             "is_fork": "--fork-session" in cmd, "is_pty": "--bg-pty-host" in cmd,
             "is_daemon": "daemon run" in cmd}
        m = re.search(r"--session-id(?:=|\s+)([0-9a-fA-F-]{36})", cmd)
        if m:
            p["session_id"] = m.group(1)
        else:
            m = re.search(r"-pty-([0-9a-fA-F-]{36})", cmd)
            if m:
                p["session_id"] = m.group(1)
        procs.append(p)
    return procs

def _scan_claude_processes() -> list[dict[str, Any]]:
    """扫描全部 claude.exe 进程（PowerShell CIM，wmic 已弃用）。
    查询失败返回 []（best-effort，调用方自行兜底）。"""
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | "
             "ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"],
            text=True, errors="replace", timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception:   # noqa: BLE001 - 进程扫描是 best-effort
        return []
    return _parse_proc_lines(out)

# ---- slug → 真实项目目录解析 ----
# Claude Code 的 slug 是真实路径的确定性变换：每个非 [A-Za-z0-9] 字符替换为单个 '-'
# （如 D:\Workspace\project-demo → D--Workspace-project-demo）。反向有损，只能在小范围候选根内
# 有界递归比对：真实项目可能嵌套在候选根之下（如 slug C--Users-20714-Desktop--- 的
# 真实目录是 Desktop\reports，仅扫直接子目录会把 Desktop 本身误当答案，导致
# claude --resume 报 No conversation found）。
_RESOLVE_CACHE: dict[str, Path | None] = {}
_DEFAULT_ROOTS_CACHE: list[Path] | None = None
# 递归时直接剪枝的大目录/无关目录，控制扫描成本。
# 注意：此列表只针对「确定不可能含项目」的巨目录/噪音目录（系统用户目录、依赖、
# 缓存、垃圾站），绝不得加入 temp/Temp/build/dist 这类常见目录名——它们完全可能
# 是合法项目或工作目录（如 D:\Workspace\temp），一旦剪枝会让
# 对应会话点「进入」报 No conversation found。扫描成本由 _MAX_SCAN_DEPTH 与
# AppData、node_modules 等巨目录剪枝共同保证，不需要靠常见目录名兜底。
_SKIP_DIR_NAMES = frozenset({
    "AppData", "node_modules", ".git", "__pycache__", ".venv", "site-packages",
    ".cache", "Cache", ".pytest_cache", ".Trash", "session_trash",
})
_MAX_SCAN_DEPTH = 3

_munge_path = core.munge_path   # slug 变换规则收归 sessions_core（纯逻辑层共用）

def _find_slug_dir(slug: str, root: Path, depth: int = 0) -> Path | None:
    """从 root 起深度 ≤ _MAX_SCAN_DEPTH 的递归精确匹配；未命中返回 None。"""
    if depth > _MAX_SCAN_DEPTH:
        return None
    if _munge_path(root) == slug:
        return root
    if depth == _MAX_SCAN_DEPTH:
        return None
    try:
        children = tuple(root.iterdir())
    except OSError:   # 无权限等：整棵子树跳过
        return None
    for child in children:
        if child.name in _SKIP_DIR_NAMES:
            continue
        try:
            if not child.is_dir() or child.is_symlink():
                continue
        except OSError:
            continue
        hit = _find_slug_dir(slug, child, depth + 1)
        if hit is not None:
            return hit
    return None

def _scan_roots() -> list[Path]:
    """候选根：vault main 目录及其直接子目录 + home + Desktop。"""
    roots: list[Path] = []
    vault_value = os.environ.get("SESSION_MANAGER_WORKSPACE_ROOT", "").strip()
    vault = Path(vault_value) if vault_value else None
    if vault is not None and vault.is_dir():
        roots.append(vault)
        roots.extend(sorted(p for p in vault.iterdir() if p.is_dir()))
    home = Path.home()
    if home not in roots:
        roots.append(home)
    desktop = home / "Desktop"
    if desktop not in roots:
        roots.append(desktop)
    return roots

def _default_roots() -> list[Path]:
    global _DEFAULT_ROOTS_CACHE
    if _DEFAULT_ROOTS_CACHE is None:   # 启动后只扫一次
        _DEFAULT_ROOTS_CACHE = _scan_roots()
    return list(_DEFAULT_ROOTS_CACHE)

def resolve_project_dir(slug: str, roots: list[Path] | None = None) -> Path | None:
    """把项目 slug 解析回真实目录；全部不中返回 None（调用方回退 home）。

    对每个候选根做深度 ≤ 3 的递归扫描，munge 结果与 slug 精确相等即命中
    （不再有 rstrip 兜底——它会误导解析到错误的父目录）；结果缓存于模块级 dict。

    缓存键为 (roots, slug) 二元组：同名 slug 在不同候选根下的解析结果必须独立，
    否则测试用不同 roots 会串缓存，生产上目录先不存在后创建也会永久走兜底。
    """
    if roots is None:
        roots = _default_roots()
    key = (tuple(roots), slug)
    if key in _RESOLVE_CACHE:
        return _RESOLVE_CACHE[key]
    hit: Path | None = None
    for r in roots:
        hit = _find_slug_dir(slug, r)
        if hit is not None:
            break
    _RESOLVE_CACHE[key] = hit
    return hit

class AppApi:
    def __init__(self, projects_dir: Path = core.DEFAULT_PROJECTS_DIR,
                 trash_dir: Path = core.DEFAULT_TRASH_DIR,
                 settings_path: Path | None = None,
                 roots: list[Path] | None = None,
                 projects_path: Path | None = None,
                 codex_sessions_dir: Path = core.DEFAULT_CODEX_SESSIONS_DIR,
                 codex_archived_dir: Path = core.DEFAULT_CODEX_ARCHIVED_DIR):
        self.projects_dir = projects_dir
        self.trash_dir = trash_dir
        self.settings_path = settings_path or (Path.home() / ".claude" / "session_manager_settings.json")
        self.roots = roots   # slug→真实路径解析的候选根；None 走默认根（vault main + home + Desktop）
        self.projects_path = projects_path or DEFAULT_PROJECTS_FILE   # 项目列表文件（可注入便于测试）
        self.codex_sessions_dir = codex_sessions_dir
        self.codex_archived_dir = codex_archived_dir
        self._window = None  # 由 run() 在 create_window 后赋值，供 pick_folder 弹原生对话框
        self._enter_cooldown: dict[str, float] = {}   # session_id → 上次成功启动时间

    def _grouped(self, sessions) -> list[dict]:
        return self._serialize(core.group_by_project(sessions))

    def _serialize(self, groups) -> list[dict]:
        return [{**g, "sessions": [{**_session_to_dict(s),
                                    "source": (s.project if s.source_tool == "codex"
                                               else src_by_slug.get(s.project, ""))}
                                   for s in g["sessions"]]}
                for g in groups
                for src_by_slug in [self._group_sources(g)]]

    # ---- 组内来源标注（source） ----
    # 合并组（同显示名的多个 slug）里，子目录会话标注相对组根的路径（如
    # Desktop\专报）。组根 = 组内最短 slug 中首个能解析的真实目录（Home 组即
    # C--Home-example → C:\Home\example）；解析失败用 slug 去掉组根 slug 前缀
    # 兜底（如 Desktop---）；仅单一 slug 的非合并组不标注（source 全为空）。

    def _group_sources(self, group: dict) -> dict[str, str]:
        slugs = sorted({s.project for s in group["sessions"]}, key=len)
        if len(slugs) <= 1:          # 非合并组：无需标注
            return {}
        root_path = None
        root_slug = ""
        for slug in slugs:           # 从最短 slug 起取首个能解析的作为组根
            p = resolve_project_dir(slug, self.roots)
            if p is not None:
                root_path = p
                root_slug = slug     # 组根 slug 跟随实际命中解析的 slug
                break
        if root_path is None:
            root_slug = slugs[0]     # 全部解析失败：兜底仍按最短 slug 去前缀
        return {slug: self._source_for(slug, root_path, root_slug) for slug in slugs}

    def _source_for(self, slug: str, root_path: Path | None, root_slug: str) -> str:
        if root_path is not None:
            resolved = resolve_project_dir(slug, self.roots)
            if resolved is not None:
                try:
                    rel = os.path.relpath(str(resolved), str(root_path))
                except ValueError:   # 跨驱动器等：走兜底
                    rel = None
                if rel == ".":
                    return ""
                if rel:
                    return rel
        # 解析失败兜底：slug 去掉组根 slug 前缀后的片段（如 Desktop---）
        if root_slug and slug.startswith(root_slug):
            return slug[len(root_slug):].lstrip("-")
        return ""

    def list_sessions(self) -> list[dict]:
        return self._grouped(core.list_sessions(self.projects_dir))

    def search(self, q: str) -> list[dict]:
        # Claude 与 Codex 共用只读搜索合同；Codex 命中不提供进入/重命名/删除。
        return self._serialize(core.search_all(
            q, self.projects_dir, self.codex_sessions_dir, self.codex_archived_dir))

    def rename_session(self, session_id: str, title: str) -> dict:
        """设置会话显示标题（写入转录首行 custom-title 记录）；薄转发 core。"""
        return core.rename_session(session_id, title, self.projects_dir)

    def stats(self) -> dict:
        return core.stats(self.projects_dir, self.trash_dir)

    def delete(self, ids: list[str]) -> dict[str, str]:
        return core.delete_sessions(ids, self.projects_dir, self.trash_dir)

    def restore(self, ids: list[str]) -> dict:
        n = core.restore_sessions(ids, self.trash_dir, self.projects_dir)
        if n < 0:
            return {"restored": 0, "error": f"{-n} 个文件恢复失败（目标已存在或移动出错）"}
        return {"restored": n, "error": None}

    def purge(self) -> dict:
        return {"purged": core.purge_trash(self.trash_dir)}

    def trash_list(self) -> list[dict]:
        return core.list_trash(self.trash_dir)

    # ---- 残留进程清理（分叉残留 / 孤儿会话） ----

    def scan_stale_processes(self) -> dict:
        """扫描 claude 进程，分类返回可清理的残留进程与活跃进程。

        残留（stale）判定，任一即算：
        - 带 --fork-session 的分叉进程（窗口从未存在，daemon 后台作业）；
        - 会话文件已不存在的孤儿会话（--session-id 指向 projects 目录外/已
          删除的会话，如源会话被删后残留的分叉）；
        - 上述进程的 --bg-pty-host 伴生进程（按管道名会话 id 归属）。
        活跃（active）：daemon、会话文件存在的普通会话（含用户正在用的当前
        终端会话）——只展示不清理。清理由 kill_stale_processes 执行，
        并在执行前重新扫描交叉验证（防竞态误杀）。
        """
        procs = _scan_claude_processes()
        by_session: dict[str, list[dict]] = {}
        for p in procs:
            if p["is_daemon"]:
                continue
            if p["session_id"]:
                by_session.setdefault(p["session_id"], []).append(p)

        def _session_file_exists(sid: str) -> bool:
            if not self.projects_dir.is_dir():
                return False
            return any((d / f"{sid}.jsonl").exists()
                       for d in self.projects_dir.iterdir() if d.is_dir())

        stale: list[dict] = []
        active: list[dict] = []
        for sid, ps in by_session.items():
            is_fork = any(p["is_fork"] for p in ps)
            orphan = not _session_file_exists(sid)
            if is_fork or orphan:
                kind = "分叉残留" if is_fork else "孤儿会话（源文件已删除）"
                for p in ps:
                    stale.append({"pid": p["pid"], "session_id": sid,
                                  "kind": "伴生进程" if p["is_pty"] else kind})
            else:
                for p in ps:
                    active.append({"pid": p["pid"], "session_id": sid,
                                   "kind": "后台终端" if p["is_pty"] else "活跃会话"})
        for p in procs:   # daemon 与无会话归属的杂项进程单列展示
            if p["is_daemon"]:
                active.append({"pid": p["pid"], "session_id": "", "kind": "daemon（守护进程，勿杀）"})
            elif not p["session_id"]:
                active.append({"pid": p["pid"], "session_id": "", "kind": "其他 claude 进程"})
        stale.sort(key=lambda x: x["pid"])
        active.sort(key=lambda x: x["pid"])
        return {"stale": stale, "active": active}

    def kill_stale_processes(self, pids: list[str]) -> dict:
        """终止残留进程（taskkill /PID /F）。

        只接受当前 scan 的 stale 集合内的 pid——每次执行前重新扫描交叉验证，
        防止确认后进程状态变化导致误杀活跃会话（如用户正在使用的终端会话）。
        返回 {pid: 结果文案}。
        """
        allowed = {p["pid"] for p in self.scan_stale_processes()["stale"]}
        out: dict[str, str] = {}
        for pid in pids:
            if pid not in allowed:
                out[pid] = "已不在残留列表（跳过）"
                continue
            try:
                r = subprocess.run(["taskkill", "/PID", pid, "/F"],
                                   capture_output=True, text=True, timeout=10,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                out[pid] = "已终止" if r.returncode == 0 else (r.stderr or r.stdout or "taskkill 失败").strip()
            except Exception as e:   # noqa: BLE001
                out[pid] = f"失败：{e}"
        return out

    # ---- 项目（Codex 式）：~/.claude/session_manager_projects.json ----

    def list_projects(self) -> list[dict]:
        """读取项目列表；文件缺失/损坏/非 list 一律返回 []。

        每条记录含 count = 该项目文件夹内（含子文件夹）的会话数：会话 slug 能
        解析出真实路径且在项目文件夹内/自身才计入（解析失败无法确认路径，不计）。
        规模小（resolve 结果已缓存），直接全量扫描可接受。

        注：read_text(utf-8) 对含无效 UTF-8 字节的文件抛 UnicodeDecodeError
        （ValueError 子类），必须一并捕获，否则异常穿透 js_api 桥接线程导致
        前端 refreshAll 的 Promise.all 拒绝、初始化链中断。
        """
        try:
            data = json.loads(self.projects_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return []
        if not isinstance(data, list):
            return []
        projects = [{"name": item["name"], "path": item["path"]}
                    for item in data
                    if isinstance(item, dict)
                    and isinstance(item.get("name"), str) and item["name"].strip()
                    and isinstance(item.get("path"), str)]
        counts = self._project_counts(projects)
        return [{**p, "count": counts.get(self._norm_path(p["path"]), 0)} for p in projects]

    def _write_projects(self, projects: list[dict]) -> None:
        """原子写：同目录临时文件 + os.replace，避免写一半损坏项目列表。"""
        self.projects_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.projects_path.with_name(self.projects_path.name + ".tmp")
        tmp.write_text(json.dumps(projects, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.projects_path)

    @staticmethod
    def _norm_path(path: str) -> str:
        return os.path.normcase(os.path.normpath(path))

    def _validate_project_name(self, name: str) -> str | None:
        """项目名校验（add_project / rename_project 共用）：非空、≤50 字符。

        返回错误文案或 None（通过）。调用方负责 strip。
        """
        name = (name or "").strip()
        if not name:
            return "名称不能为空"
        if len(name) > 50:
            return "名称不能超过 50 个字符"
        return None

    def add_project(self, name: str, path: str) -> dict:
        """校验并追加项目；name 非空 ≤50 字符、path 存在且是目录、无重复 name/path。"""
        name = (name or "").strip()
        err = self._validate_project_name(name)
        if err:
            return {"ok": False, "error": err}
        if not path or not os.path.isdir(path):
            return {"ok": False, "error": "路径不存在或不是文件夹"}
        projects = self.list_projects()
        if any(p["name"] == name for p in projects):
            return {"ok": False, "error": "已存在同名项目"}
        norm = self._norm_path(path)
        if any(self._norm_path(p["path"]) == norm for p in projects):
            return {"ok": False, "error": "该项目路径已添加"}
        projects.append({"name": name, "path": path})
        try:
            self._write_projects(projects)
        except OSError as e:
            return {"ok": False, "error": f"保存失败：{e}"}
        return {"ok": True, "error": None}

    def rename_project(self, path: str, new_name: str) -> dict:
        """按 path（normcase 归一化匹配）定位项目并重命名其显示名称。

        名称校验与 add_project 一致（非空 ≤50 字符、与另一项目不重名）；重命名只改
        列表里的显示标签，与 slug/会话列表分组无关（分组按真实路径 friendly_name，
        见 sessions_core）。写入前剔除 list_projects 附加的 count 瞬时字段，保持
        项目文件只含 name/path（原子写复用 _write_projects）。
        """
        projects = self.list_projects()
        norm = self._norm_path(path)
        target = next((p for p in projects if self._norm_path(p["path"]) == norm), None)
        if target is None:
            return {"ok": False, "error": "项目不存在"}
        new_name = (new_name or "").strip()
        err = self._validate_project_name(new_name)
        if err:
            return {"ok": False, "error": err}
        if any(p["name"] == new_name and p is not target for p in projects):
            return {"ok": False, "error": "已存在同名项目"}
        target["name"] = new_name
        records = [{k: p[k] for k in ("name", "path")} for p in projects]
        try:
            self._write_projects(records)
        except OSError as e:
            return {"ok": False, "error": f"保存失败：{e}"}
        return {"ok": True, "error": None}

    def move_project(self, src_path: str, dst_path: str) -> dict:
        """调整项目顺序：把 src 项目移到 dst 项目之前；dst 为空串表示移到末尾。

        只改列表顺序（name/path 不变），顺序随项目文件持久化，重启后保持。
        写入前剔除 list_projects 附加的 count 瞬时字段（复用原子写）。
        """
        projects = self.list_projects()
        norm = self._norm_path(src_path)
        idx = next((i for i, p in enumerate(projects) if self._norm_path(p["path"]) == norm), None)
        if idx is None:
            return {"ok": False, "error": "项目不存在"}
        src = projects.pop(idx)
        if dst_path:
            dst_norm = self._norm_path(dst_path)
            dst_idx = next((i for i, p in enumerate(projects) if self._norm_path(p["path"]) == dst_norm), None)
            if dst_idx is None:
                return {"ok": False, "error": "目标项目不存在"}
            projects.insert(dst_idx, src)   # 插到目标之前
        else:
            projects.append(src)
        records = [{k: p[k] for k in ("name", "path")} for p in projects]
        try:
            self._write_projects(records)
        except OSError as e:
            return {"ok": False, "error": f"保存失败：{e}"}
        return {"ok": True, "error": None}

    def remove_project(self, path: str) -> dict:
        projects = self.list_projects()
        norm = self._norm_path(path)
        projects = [p for p in projects if self._norm_path(p["path"]) != norm]
        try:
            self._write_projects(projects)
        except OSError as e:
            return {"ok": False, "error": f"保存失败：{e}"}
        return {"ok": True}

    def project_sessions(self, path: str) -> list[dict]:
        """返回项目文件夹内的全部会话：真实路径在项目文件夹内/自身（含子文件夹）。

        条目序列化格式与 list_sessions 的会话一致（id/project/when/size_kb/
        preview/active/title），另加 source = 会话真实路径相对项目文件夹的路径
        （项目根自身为 ""），按时间倒序。slug 解析失败的会话无法确认真实路径，
        一律排除（不误归入任何项目，list_projects 的 count 同样不计）。
        """
        root = Path(path).resolve()
        hits = []
        for s in core.list_sessions(self.projects_dir):
            src = self._project_hit(s, root)
            if src is not None:
                hits.append((s, src))
        hits.sort(key=lambda t: t[0].ts, reverse=True)
        return [{**_session_to_dict(s), "source": src} for s, src in hits]

    def _project_hit(self, s: core.Session, root: Path) -> str | None:
        """会话真实路径在 root 内/自身 → 返回相对路径（根自身 ""），否则 None。

        Windows 大小写不敏感：比较前统一 os.path.normcase（Path.resolve 不归一
        化大小写，直接 is_relative_to 会在注册路径与真实路径大小写不一致时漏配）；
        显示用 source 以真实路径（rp.parts）重建，避免 normcase 小写化。

        版本前提：依赖 Python ≥3.13 的 Windows normcase 行为（小写化但保留反斜杠
        分隔符）；≤3.12 的 normcase 会把分隔符转成斜杠，rn + os.sep 前缀判定与
        relpath 将失效、子文件夹会话漏配。打包 exe 与本机解释器均为 3.14，满足。
        """
        resolved = resolve_project_dir(s.project, self.roots)
        if resolved is None:
            # 解析失败兜底（项目文件夹在扫描根之外，如 move_session 移入的自定义
            # 目录）：用转录首条精确 cwd 记录，使这类会话仍显示在项目卡片/计数里。
            resolved = self._first_recorded_cwd(s.id, s.project)
        if resolved is None:
            return None
        try:
            rp = resolved.resolve()
        except OSError:
            rp = resolved
        rn = os.path.normcase(str(root))
        sn = os.path.normcase(str(rp))
        if sn == rn:
            return ""
        if not sn.startswith(rn + os.sep):
            return None
        rel = os.path.relpath(sn, rn)
        if rel == ".":
            return ""
        parts = rel.split(os.sep)
        return os.sep.join(rp.parts[-len(parts):])

    def _project_counts(self, projects: list[dict]) -> dict[str, int]:
        """各项目文件夹内会话数（含子文件夹）；项目列表为空不扫会话。"""
        if not projects:
            return {}
        entries = [(self._norm_path(p["path"]), Path(p["path"]).resolve()) for p in projects]
        counts = {key: 0 for key, _ in entries}
        for s in core.list_sessions(self.projects_dir):
            for key, root in entries:
                if self._project_hit(s, root) is not None:
                    counts[key] += 1
                    break
        return counts

    def move_session_to_project(self, session_id: str, target_path: str) -> dict:
        """把会话移动到另一已注册项目文件夹（物理移动 + 改写 cwd，见 core.move_session）。

        目标必须是已添加的项目（前端拖拽落点即项目卡片）；委托 core 处理文件
        迁移与失败回滚。移动后 _FIRST_CWD_CACHE 的旧键不会命中（slug 已变）。
        """
        if not target_path:
            return {"ok": False, "error": "目标项目路径为空"}
        projects = self.list_projects()
        if not any(self._norm_path(p["path"]) == self._norm_path(target_path) for p in projects):
            return {"ok": False, "error": "目标不是已添加的项目"}
        return core.move_session(session_id, target_path, self.projects_dir)

    def start_project_session(self, path: str) -> dict:
        """在项目文件夹新开终端跑 claude（不带参数 = 全新会话），cwd=项目文件夹。

        该文件夹下的历史会话不受影响，仍走现有 enter()（--resume）打开。
        """
        if not path or not os.path.isdir(path):
            return {"ok": False, "error": "项目路径不存在或不是文件夹"}
        claude = (self.get_settings().get("claude_path") or shutil.which("claude") or "")
        if not claude:
            return {"ok": False, "error": "未找到 claude，请在设置中配置路径"}
        try:
            subprocess.Popen([claude],
                             creationflags=subprocess.CREATE_NEW_CONSOLE,
                             cwd=path, env=_claude_env())
        except OSError as e:
            return {"ok": False, "error": f"无法启动 claude：{e}"}
        return {"ok": True, "error": None}

    def pick_folder(self) -> dict:
        """原生文件夹选择对话框（FOLDER_DIALOG）；用户取消时 path 为 None。

        线程约束实测结论见源码：pywebview 6.2.1 的 JS API 方法在独立桥接线程执行
        （webview/util.py js_bridge_call → Thread），winforms 后端 create_file_dialog
        走原生 Vista 风格 IFileDialog.Show(parent.Handle)（自带模态消息循环、无
        WinForms 跨线程封送，webview/platforms/winforms.py OpenFolderDialog.show），
        Python 层仅有 @_shown_call 门控（窗口已显示即可）。故从桥接线程直接调用
        在本机 WebView2/WinForms 下可行；若实测对话框不弹，回退方案为主线程桥接
        （webview.start(func) + 事件队列），见 projects-report。
        """
        window = getattr(self, "_window", None)
        if window is None:
            return {"ok": False, "path": None, "name": None, "error": "窗口未就绪"}
        import webview
        try:
            picked = window.create_file_dialog(webview.FileDialog.FOLDER)
        except Exception as e:   # noqa: BLE001 - 对话框异常统一转错误 dict
            return {"ok": False, "path": None, "name": None,
                    "error": f"打开文件夹选择失败：{e}"}
        if not picked:
            return {"ok": True, "path": None, "name": None, "error": None}   # 用户取消
        path = picked[0] if isinstance(picked, (tuple, list)) else str(picked)
        selected = Path(path)
        # 新建项目默认使用最后一级文件夹名；选择驱动器根目录时回退到盘符。
        suggested_name = selected.name or selected.drive.rstrip("\\/:") or str(path)
        return {"ok": True, "path": path, "name": suggested_name, "error": None}

    def close_window(self) -> dict:
        """Python 侧销毁窗口（替代前端 window.close()——pywebview 6.2.1 中它是
        空操作，窗口不会关闭）。close_after_enter 与冒烟自关共用。"""
        window = getattr(self, "_window", None)
        if window is None:
            return {"ok": False, "error": "窗口未就绪"}
        window.destroy()
        return {"ok": True, "error": None}

    def _project_slug_for(self, session_id: str) -> str | None:
        """在 projects 目录中定位会话所属的项目 slug（projects/<slug>/<id>.jsonl）。"""
        if not self.projects_dir.is_dir():
            return None
        for slug_dir in self.projects_dir.iterdir():
            if slug_dir.is_dir() and (slug_dir / f"{session_id}.jsonl").exists():
                return slug_dir.name
        return None

    def _recorded_project_cwds(self, session_id: str, slug: str) -> list[Path]:
        """读取 JSONL 中与项目 slug 精确对应的 cwd，保持首次出现顺序。

        Claude 的 JSONL 会同时记录项目根目录及其子目录 cwd；只有 munge 后与会话
        所属 slug 完全一致的路径才是可用于 ``claude --resume`` 的项目作用域。
        解析只在用户点击“进入”时发生，不参与列表刷新。
        """
        session_file = self.projects_dir / slug / f"{session_id}.jsonl"
        found: list[Path] = []
        seen: set[str] = set()
        try:
            with session_file.open("r", encoding="utf-8") as fh:
                for line in fh:
                    try:
                        data = json.loads(line)
                    except (json.JSONDecodeError, TypeError):
                        continue
                    raw_cwd = data.get("cwd") if isinstance(data, dict) else None
                    if not isinstance(raw_cwd, str) or not raw_cwd.strip():
                        continue
                    candidate = Path(raw_cwd)
                    # Windows 大小写不敏感：slug 比较一律小写化，避免对话框/终端
                    # 大小写写法不同导致 move_session 改写后的 cwd 匹配失败
                    if not candidate.is_absolute() or _munge_path(candidate).lower() != slug.lower():
                        continue
                    key = os.path.normcase(str(candidate))
                    if key not in seen:
                        seen.add(key)
                        found.append(candidate)
        except OSError:
            return []
        return found

    _FIRST_CWD_CACHE: dict[tuple[str, str], Path | None] = {}

    def _first_recorded_cwd(self, session_id: str, slug: str) -> Path | None:
        """与 slug 精确对应（大小写不敏感）的首个 cwd 记录；未命中返回 None。

        只读首个命中即返回（转录通常头部几十行内就有 cwd，成本可控），按
        (id, slug) 缓存：move_session 改变归属后 slug 必变，不会命中旧缓存
        （与 _RESOLVE_CACHE 同理，见 resolve_project_dir 的说明）。
        """
        key = (session_id, slug)
        if key in self._FIRST_CWD_CACHE:
            return self._FIRST_CWD_CACHE[key]
        session_file = self.projects_dir / slug / f"{session_id}.jsonl"
        try:
            with session_file.open("r", encoding="utf-8") as fh:
                for line in fh:
                    try:
                        data = json.loads(line)
                    except (json.JSONDecodeError, TypeError):
                        continue
                    raw_cwd = data.get("cwd") if isinstance(data, dict) else None
                    if not isinstance(raw_cwd, str) or not raw_cwd.strip():
                        continue
                    candidate = Path(raw_cwd)
                    if not candidate.is_absolute() or _munge_path(candidate).lower() != slug.lower():
                        continue
                    self._FIRST_CWD_CACHE[key] = candidate
                    return candidate
        except OSError:
            pass
        self._FIRST_CWD_CACHE[key] = None
        return None

    def _enter_cwd(self, session_id: str, slug: str,
                   roots: list[Path] | None = None) -> tuple[Path | None, list[Path]]:
        """优先使用 JSONL 的精确 cwd；无记录时再使用有界目录扫描。"""
        recorded = self._recorded_project_cwds(session_id, slug)
        for candidate in recorded:
            if candidate.is_dir():
                return candidate, recorded
        return resolve_project_dir(slug, roots), recorded

    def enter(self, session_id: str, roots: list[Path] | None = None) -> dict:
        # 进程级占用检查（终极防分叉）：目标会话有存活 claude 进程时，再 resume
        # 会被 Claude Code 自动分叉成重复会话（实测：分叉进程由 daemon 以
        # --bg-pty-host 后台作业托管，**窗口关闭后进程仍存活**，mtime 活动检测
        # 拦不住；source 会话自身也带 --session-id/--resume 命令行）。直接拒绝，
        # 让用户先真正结束会话（或确认后台作业）再进入。
        live = session_live_pids(session_id)
        if live:
            return {"ok": False, "code": "session_running", "pids": live,
                    "error": f"该会话仍有存活进程（PID {', '.join(live)}）——窗口可能已关闭，但会话仍在后台运行。再次进入会被 Claude 自动分叉成重复会话，已停止启动。"}
        # 防重复进入：同一会话 5 秒内已成功启动过 claude 则忽略本次点击。快速
        # 双击/连点会并行启动两个 claude --resume，Claude Code 会把第二个进程
        # 自动分叉成新会话（复制消息链、sessionKind=bg），项目内出现"两个相同
        # 对话"（实测 2026-08-06）。时间戳只在启动成功后记录，失败可立即重试。
        if time.time() - self._enter_cooldown.get(session_id, 0.0) < _ENTER_COOLDOWN_SECONDS:
            return {"ok": False, "error": "刚刚已为该会话启动过 claude（重复进入会产生分叉副本），已忽略本次点击"}
        claude = (self.get_settings().get("claude_path") or shutil.which("claude") or "")
        if not claude:
            return {"ok": False, "error": "未找到 claude，请在设置中配置路径"}
        slug = self._project_slug_for(session_id)
        if not slug:
            return {"ok": False, "code": "session_not_found",
                    "error": "未找到该会话的转录文件"}

        # 跨实例互斥（2026-08-08）：5 秒冷却是单实例内存态、进程扫描拦不住
        # claude 尚未启动的瞬间——双实例并发点同一会话「进入」仍会分叉。用独占
        # 创建锁文件实现跨进程互斥：拿不到锁（另一实例正在进入）直接拒绝；
        # claude 启动完成后放锁（进程扫描接管后续拦截），残留锁由
        # acquire_enter_lock 的死 PID 检测自愈。
        lock_path = self.projects_dir / slug / f".{session_id}.enter.lock"
        acquired, lock_err = core.acquire_enter_lock(lock_path)
        if not acquired:
            return {"ok": False, "code": "enter_locked", "error": lock_err}
        try:
            # claude --resume 按当前工作目录的项目作用域查找会话。优先读取 JSONL
            # 自带的 cwd，解决工作目录位于默认扫描根之外时错误回退 home 的问题。
            resolved, recorded = self._enter_cwd(session_id, slug, roots)
            if resolved is None:
                if recorded:
                    missing_path = str(recorded[0])
                    return {"ok": False, "code": "project_dir_missing",
                            "missing_path": missing_path,
                            "error": f"原工作目录已不存在：{missing_path}"}
                return {"ok": False, "code": "project_dir_unresolved",
                        "error": "无法确定该会话的原工作目录，已停止启动 Claude"}

            cwd = str(resolved)
            # 净化子进程环境：见 _claude_env（enter 与 start_project_session 共用）
            try:
                subprocess.Popen([claude, "--resume", session_id],
                                 creationflags=subprocess.CREATE_NEW_CONSOLE,
                                 cwd=cwd, env=_claude_env())
            except OSError as e:
                return {"ok": False, "error": f"无法启动 claude：{e}"}
            self._enter_cooldown[session_id] = time.time()
            return {"ok": True, "error": None}
        finally:
            core.release_enter_lock(lock_path)

    def recover_missing_project(self, session_id: str) -> dict:
        """在用户通过页面内模态确认后，重建 JSONL 记录的原项目空目录并恢复。

        不复制、不移动、不改写任何会话文件；目标路径必须来自该会话 JSONL，且
        munge 后与所属 slug 完全一致，避免前端传入任意路径创建目录。
        """
        slug = self._project_slug_for(session_id)
        if not slug:
            return {"ok": False, "error": "未找到该会话的转录文件"}
        recorded = self._recorded_project_cwds(session_id, slug)
        if not recorded:
            return {"ok": False, "error": "会话记录中没有可恢复的原工作目录"}

        target = recorded[0]
        if target.exists() and not target.is_dir():
            return {"ok": False, "error": f"原路径已被同名文件占用：{target}"}
        try:
            target.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return {"ok": False, "error": f"无法重建原工作目录：{e}"}

        result = self.enter(session_id)
        if result.get("ok"):
            result["created_path"] = str(target)
        return result

    def get_settings(self) -> dict:
        try:
            data = json.loads(self.settings_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):   # 合法 JSON 但非 dict（数组/字符串等）回退默认值
                data = {}
            return {**DEFAULT_SETTINGS, **data}
        except (OSError, json.JSONDecodeError):
            return dict(DEFAULT_SETTINGS)

    def set_settings(self, settings: dict) -> dict:
        merged = {**self.get_settings(), **settings}
        try:
            self.settings_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            pass
        return merged

def _smoke_auto_close_ms() -> float | None:
    """冒烟专用：解析 SESSION_MANAGER_SMOKE_AUTO_CLOSE_MS（正整数毫秒）→ 秒。

    缺失/空串/非数字/非正数 → None（正常使用路径）。纯函数便于单元测试；
    run() 仅在该分支非 None 时才启动定时销毁窗口。
    """
    raw = os.environ.get("SESSION_MANAGER_SMOKE_AUTO_CLOSE_MS", "")
    if raw.isdigit() and int(raw) > 0:
        return int(raw) / 1000.0
    return None

def run() -> None:
    import webview
    api = AppApi()
    # 注：本机 pywebview 6.2.1 的 create_window 无 icon 参数（传参即 TypeError），
    # 已省略；打包后 exe 图标由 PyInstaller --icon 提供（见 build.bat / Task 10）。
    # url 必须为 str：resource_path 返回 Path，pywebview 6.2.1 的 start() 会对其
    # 直接调用 str.startswith（is_local_url），传 Path 会 AttributeError（实测）。
    window = webview.create_window(
        "会话管家", str(resource_path("web/index.html")),
        width=960, height=640, min_size=(720, 480),
        js_api=api,
    )
    api._window = window   # pick_folder / close_window 需要 window 引用
    # 冒烟专用：设置 SESSION_MANAGER_SMOKE_AUTO_CLOSE_MS（正整数毫秒）时，
    # 启动后定时销毁窗口自动退出（JS window.close() 在 pywebview 6.2.1 是空操作），
    # 正常使用不设该变量。destroy 经 winforms 端 Invoke 封送 UI 线程，Timer 线程
    # 调用安全；解析逻辑见 _smoke_auto_close_ms（纯函数，可单测）。
    seconds = _smoke_auto_close_ms()
    if seconds is not None:
        threading.Timer(seconds, window.destroy).start()
    webview.start()

if __name__ == "__main__":
    run()
