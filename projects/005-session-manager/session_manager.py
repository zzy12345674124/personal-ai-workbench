"""会话管家 CLI（薄壳，逻辑在 sessions_core.py）。用法与原版一致。"""
import argparse, sys
from pathlib import Path
import sessions_core as core

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

def cmd_list(args):
    sessions = core.list_sessions(exclude=args.exclude)
    if args.limit:
        sessions = sessions[:args.limit]
    if not sessions:
        print("（没有找到会话转录）")
        return 0
    print(f"{'ID':<3} {'时间':<17} {'项目':<42} {'大小':<6} 预览")
    print("-" * 140)
    for i, s in enumerate(sessions):
        flag = " ⚡活跃" if s.active else ""
        print(f"{i:<3} {s.when:<17} {s.project[:42]:<42} {s.size_kb}KB   {s.preview}{flag}")
    print(f"\n共 {len(sessions)} 个会话。删除：python session_manager.py delete <ID>")
    return 0

def cmd_delete(args):
    sessions = core.list_sessions(exclude=args.exclude)
    targets = []
    for token in args.ids:
        matches = [s for s in sessions if s.id.startswith(token)]
        if len(matches) == 1:
            targets.append(matches[0])
        elif token.isdigit() and int(token) < len(sessions):
            targets.append(sessions[int(token)])
        else:
            print(f"✗ 无法解析「{token}」：无唯一匹配。")
    if not targets:
        print("没有可删除的目标。")
        return 1
    print("以下会话将被移入回收站（可 restore 恢复）：")
    for s in targets:
        print(f"  [{s.id}] {s.when} {s.project} — {s.preview[:60]}")
    if not args.yes:
        if input("确认删除？(y/N): ").strip().lower() not in ("y", "yes"):
            print("已取消。")
            return 0
    for sid, msg in core.delete_sessions([s.id for s in targets]).items():
        print(f"{sid}: {msg}")
    return 0

def cmd_restore(args):
    n = core.restore_sessions([args.id])
    if n < 0:
        print(f"✗ 恢复失败：{-n} 个文件未能恢复（目标已存在或移动出错）。")
    else:
        print(f"已恢复 {n} 个文件。")
    return 0

def cmd_trash(args):
    items = core.list_trash()
    if not items:
        print("回收站为空。")
        return 0
    for t in items:
        print(f"  [{t['id']}] {t['when']} {t['project']} — {t['preview'][:50]}")
    print(f"\n回收站位置：{core.DEFAULT_TRASH_DIR}")
    return 0

def cmd_purge(args):
    if not args.force:
        if input(f"将永久删除回收站全部内容（{core.DEFAULT_TRASH_DIR}）。确认？(y/N): ").strip().lower() not in ("y", "yes"):
            print("已取消。")
            return 0
    n = core.purge_trash()
    print(f"回收站已清空（{n} 个会话）。")
    return 0

def main(argv=None):
    p = argparse.ArgumentParser(description="Claude Code 会话回收站（CLI）")
    sub = p.add_subparsers(dest="cmd", required=True)
    pl = sub.add_parser("list"); pl.add_argument("--exclude"); pl.add_argument("--limit", type=int)
    pd = sub.add_parser("delete"); pd.add_argument("ids", nargs="+"); pd.add_argument("--exclude"); pd.add_argument("--yes", action="store_true")
    pr = sub.add_parser("restore"); pr.add_argument("id")
    sub.add_parser("trash")
    pp = sub.add_parser("purge"); pp.add_argument("--force", action="store_true")
    args = p.parse_args(argv)
    return {"list": cmd_list, "delete": cmd_delete, "restore": cmd_restore,
            "trash": cmd_trash, "purge": cmd_purge}[args.cmd](args)

if __name__ == "__main__":
    raise SystemExit(main())
