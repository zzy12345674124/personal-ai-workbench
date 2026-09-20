# scripts/run-video.py —— 视频生成一条龙（任务分级 2026-08-07）
# 机械杂活脚本化：提交 → 轮询 → 闸门自动确认 → 终态汇总（0 模型成本，替代手写监控循环）
# 用法：
#   python scripts/run-video.py "主题" [--angle 角度] [--mode fallback|normal]
#     [--timeliness strict|relaxed|custom] [--rules "自定义时效要求"] [--no-confirm] [--poll 30]
# 中文参数安全：urllib 宽字符提交（避免 Git Bash curl 的 GBK 乱码坑）
import argparse
import json
import sys
import time
import urllib.request

API = 'http://127.0.0.1:8080'


def api(path: str, data: dict | None = None) -> dict:
    body = json.dumps(data, ensure_ascii=False).encode('utf-8') if data else None
    req = urllib.request.Request(API + path, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))


def main() -> int:
    ap = argparse.ArgumentParser(description='视频生成一条龙：提交→监控→自动确认→汇总')
    ap.add_argument('topic', help='视频主题')
    ap.add_argument('--angle', default='', help='角度/受众')
    ap.add_argument('--mode', default='fallback', choices=['fallback', 'normal'])
    ap.add_argument('--timeliness', default='strict', choices=['strict', 'relaxed', 'custom'])
    ap.add_argument('--rules', default='', help='custom 模式的时效要求文本')
    ap.add_argument('--scene-draft', default='', help='场景草稿 JSON（@前缀=读文件，如 @scene.json；2026-08-08 素材进视频验证用）')
    ap.add_argument('--no-confirm', action='store_true', help='到闸门不自动确认（手动）')
    ap.add_argument('--poll', type=int, default=30, help='轮询间隔秒')
    args = ap.parse_args()

    payload = {'topic': args.topic, 'angle': args.angle, 'mode': args.mode, 'timeliness': args.timeliness}
    if args.timeliness == 'custom' and args.rules:
        payload['timelinessRules'] = args.rules
    if args.scene_draft:
        if args.scene_draft.startswith('@'):
            with open(args.scene_draft[1:], encoding='utf-8') as f:
                payload['sceneDraft'] = f.read()
        else:
            payload['sceneDraft'] = args.scene_draft
        json.loads(payload['sceneDraft'])  # 提前校验 JSON（坏草稿不烧钱）
        print(f'[submit] 场景草稿已携带（{len(payload["sceneDraft"])} 字符）')
    try:
        run_id = api('/api/video/submit', payload)['data']['runId']
    except Exception as e:  # noqa: BLE001 - 脚本兜底
        print(f'[submit] 失败：{e}（server 在跑吗？http://127.0.0.1:8080）')
        return 1
    print(f'[submit] {run_id} 主题={args.topic} 模式={args.mode} 时效={args.timeliness}')

    started = time.time()
    confirmed = False
    while True:
        try:
            d = api(f'/api/video/status?id={run_id}')['data']
        except Exception as e:  # noqa: BLE001
            print(f'[status] 查询失败：{e}')
            time.sleep(args.poll)
            continue
        stage, detail = d.get('stage'), d.get('detailStage')
        elapsed = int(time.time() - started)
        line = f'[{elapsed:>4}s] {stage}'
        if detail:
            line += f' {detail}'
        print(line)
        if stage == 'draft_ready' and not confirmed:
            if args.no_confirm:
                print('[gate] 等待手动确认生产…')
            else:
                try:
                    api('/api/video/confirm', {'id': run_id})
                    print('[gate] 自动确认生产')
                except Exception as e:  # noqa: BLE001
                    print(f'[gate] 确认失败：{e}')
                    return 1
            confirmed = True
        if stage in ('done', 'failed', 'missing'):
            print('=' * 44)
            print(f'runId: {run_id}')
            print(f'stage: {stage}（耗时 {int(time.time() - started)}s）')
            for model, c in (d.get('cost') or {}).items():
                print(f"cost {model}: ${c.get('costUsd', 0):.4f}（{c.get('inputTokens', 0)} in / {c.get('outputTokens', 0)} out）")
            if d.get('produce'):
                print('produce:', json.dumps(d.get('produce'), ensure_ascii=False))
            if d.get('finalMp4'):
                print(f'final.mp4: {API}/api/video/download?id={run_id}')
            if d.get('error'):
                print('error:', d['error'])
            return 0 if stage == 'done' else 1
        time.sleep(args.poll)


if __name__ == '__main__':
    sys.exit(main())
