# xhs-crawl.py —— 小红书评论爬虫（登录态档案 + 页面滚动翻页 + 被动收集评论接口）
# 用法：python scripts/xhs-crawl.py <note_url...> （可传多个，逗号分隔或用空串读文件）
# 输出：runs/xhs-comments/<note_id>.json
import sys, json, os, time, re, urllib.parse
from cloakbrowser import launch_persistent_context

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = os.path.join(os.path.expanduser('~'), '.cloakbrowser', 'profiles', 'xhs')
OUT_DIR = os.path.join(PROJECT_ROOT, 'runs', 'xhs-comments')
os.makedirs(OUT_DIR, exist_ok=True)

URLS = sys.argv[1:] if len(sys.argv) > 1 else []


def note_id_of(url):
    if '/explore/' in url:
        return url.split('/explore/')[1].split('?')[0]
    return url.split('?')[0].split('/')[-1]


def crawl(page, url):
    nid = note_id_of(url)
    collected = []
    collected_lock = threading.Lock()

    def on_response(resp):
        if 'comment/page' in resp.url and resp.status == 200:
            try:
                j = json.loads(resp.text())
                cmts = (j.get('data') or {}).get('comments') or []
                if cmts:
                    with collected_lock:
                        collected.append(cmts)
            except Exception:
                pass

    page.on('response', on_response)
    page.goto(url, wait_until='domcontentloaded', timeout=45000)
    page.wait_for_timeout(8000)
    # 滚动评论容器到底，触发分页（最多 80 次×2.5s）
    for _ in range(80):
        more = page.evaluate(
            """() => {
              const els = [...document.querySelectorAll('div,section')].filter(e =>
                e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200);
              if (!els.length) return false;
              let best = els[0];
              for (const e of els) if (e.scrollHeight > best.scrollHeight) best = e;
              const before = best.scrollTop;
              best.scrollTop = best.scrollHeight;
              return best.scrollTop > before;
            }"""
        )
        page.wait_for_timeout(2500)
        if not more:
            break
    page.wait_for_timeout(4000)

    # 汇总 JSON：去重（接口分页可能重叠）
    seen = set()
    comments = []
    for cmts in collected:
        for c in cmts:
            cid = c.get('id', '')
            if cid in seen:
                continue
            seen.add(cid)
            comments.append({
                'id': cid,
                'nickname': (c.get('user_info') or {}).get('nickname', ''),
                'content': (c.get('content') or '').strip(),
                'likes': c.get('like_count', 0),
                'time': c.get('create_time', ''),
                'ip': c.get('ip_location', ''),
                'replies': [{
                    'id': r.get('id', ''),
                    'nickname': (r.get('user_info') or {}).get('nickname', ''),
                    'content': (r.get('content') or '').strip(),
                    'likes': r.get('like_count', 0),
                    'time': r.get('create_time', ''),
                } for r in (c.get('sub_comments') or c.get('comments') or [])],
            })
    out = {
        'note_id': nid, 'url': url, 'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'count': len(comments), 'comments': comments,
    }
    path = os.path.join(OUT_DIR, f'{nid}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f'[crawl] {nid}: {len(comments)} 条评论（含回复）→ {path}')
    return len(comments)


import threading

def main():
    with launch_persistent_context(PROFILE, headless=True) as ctx:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        for url in URLS:
            try:
                crawl(page, url)
            except Exception as e:
                print(f'[crawl] {url[:40]} 失败: {e}')


if __name__ == '__main__':
    main()
