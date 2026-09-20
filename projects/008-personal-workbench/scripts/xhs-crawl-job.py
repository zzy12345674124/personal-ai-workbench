# xhs-crawl-job.py —— 小红书评论采集服务版（工作台面板调用）
# 用法：python scripts/xhs-crawl-job.py --job <job.json>
# job.json: { jobId, urls: ["https://..."...], pauseMs: 2500, keyword: "" }
# 输出：runs/xhs-comments/<jobId>.log（进度日志，面板轮询） + <jobId>-<note_id>.json（数据）
import sys, json, os, time, re, urllib.parse
from cloakbrowser import launch_persistent_context

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = os.path.join(os.path.expanduser('~'), '.cloakbrowser', 'profiles', 'xhs')
BASE = os.path.join(PROJECT_ROOT, 'runs', 'xhs-comments')
os.makedirs(BASE, exist_ok=True)
SEARCH_URL = 'https://so.xiaohongshu.com/api/sns/web/v2/search/notes'


def search_notes(page, kw, max_pages=3, per_word=3, pause_ms=4000):
    """小红书搜索页被动收集：返回带 token 的 note 链接列表（上限 per_word）"""
    found = []

    def on_resp(resp):
        if SEARCH_URL in resp.url and resp.status == 200 and len(found) < per_word:
            try:
                j = json.loads(resp.text())
                for it in ((j.get('data') or {}).get('items') or []):
                    nid = it.get('id') or ''
                    tok = (it.get('xsec_token') or it.get('note_card', {}).get('xsec_token') or '')
                    if nid and len(found) < per_word:
                        url = f'https://www.xiaohongshu.com/explore/{nid}'
                        if tok:
                            url += f'?xsec_token={tok}&xsec_source=pc_search'
                        found.append(url)
            except Exception:
                pass

    page.on('response', on_resp)
    page.goto(f'https://www.xiaohongshu.com/search_result?keyword={urllib.parse.quote(kw)}&type=51',
              wait_until='domcontentloaded', timeout=45000)
    page.wait_for_timeout(8000)
    rounds = 0
    while len(found) < per_word and rounds < max_pages * 3:
        page.evaluate("""() => { const els = [...document.querySelectorAll('div,section')].filter(e =>
            e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200);
            if (!els.length) return; let best = els[0];
            for (const e of els) if (e.scrollHeight > best.scrollHeight) best = e;
            best.scrollTop = best.scrollHeight; }""")
        page.wait_for_timeout(pause_ms)
        rounds += 1
    # DOM 兜底（接口未捕获时直接抓链接）
    if len(found) < per_word:
        links = page.evaluate("() => [...document.querySelectorAll('a')].map(a => a.href).filter(h => /explore\\//.test(h))")
        for l in links:
            if len(found) >= per_word:
                break
            if l not in found:
                found.append(l)
    return found[:per_word]


def log(job_id, line):
    with open(os.path.join(BASE, f'{job_id}.log'), 'a', encoding='utf-8') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {line}\n')
    print(line)


def note_id_of(url):
    if '/explore/' in url:
        return url.split('/explore/')[1].split('?')[0]
    return url.split('?')[0].split('/')[-1]


def crawl_page(page, url, keyword, pause_ms, max_pages=0, meta=None):
    # meta: {'job_id', 'keyword'} —— 数据归属（可视化按关键词筛选用）
    nid = note_id_of(url)
    collected = []

    def on_response(resp):
        if 'comment/page' in resp.url and resp.status == 200:
            try:
                j = json.loads(resp.text())
                cmts = (j.get('data') or {}).get('comments') or []
                if cmts:
                    collected.append(cmts)
            except Exception:
                pass

    page.on('response', on_response)
    page.goto(url, wait_until='domcontentloaded', timeout=45000)
    page.wait_for_timeout(7000)
    # 滚动逻辑与已验证的 xhs-crawl.py 一致：固定轮数、每轮无条件滚到底、无早退——
    # 滚动容器选择会随页面状态抖动，moved 早退曾导致只翻 1-2 页（20 条）。
    # max_pages>0（增量采集页数）：达到页数上限后停止滚动（截断采集）。
    for _ in range(80):
        if max_pages > 0 and len(collected) >= max_pages:
            break
        page.evaluate(
            """() => {
              const els = [...document.querySelectorAll('div,section')].filter(e =>
                e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200);
              if (!els.length) return;
              let best = els[0];
              for (const e of els) if (e.scrollHeight > best.scrollHeight) best = e;
              best.scrollTop = best.scrollHeight;
            }"""
        )
        page.wait_for_timeout(pause_ms)  # wait_for_timeout 单位是毫秒（直接传，勿除 1000）
    page.wait_for_timeout(4000)

    seen = set()
    comments = []
    for cmts in collected:
        for c in cmts:
            cid = c.get('id', '')
            if cid in seen:
                continue
            seen.add(cid)
            comments.append({
                'id': cid, 'nickname': (c.get('user_info') or {}).get('nickname', ''),
                'content': (c.get('content') or '').strip(), 'likes': c.get('like_count', 0),
                'time': c.get('create_time', ''), 'ip': c.get('ip_location', ''),
            })

    keep = comments
    if keyword:
        keep = [c for c in comments if keyword in c['content']]

    out = {'job_id': (meta or {}).get('job_id', ''), 'keyword': (meta or {}).get('keyword', ''),
           'note_id': nid, 'url': url,
           'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
           'count': len(keep), 'filtered_from': len(comments),
           'comments': keep}
    out_path = os.path.join(BASE, f'{nid}.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return len(keep), len(comments), out_path


def main():
    args = sys.argv[1:]
    job_path = args[args.index('--job') + 1] if '--job' in args else None
    if not job_path:
        print('usage: xhs-crawl-job.py --job job.json')
        return
    with open(job_path, encoding='utf-8') as f:
        job = json.load(f)
    job_id = job.get('jobId', 'job')
    urls = job.get('urls', [])
    keyword = job.get('keyword', '')
    pause_ms = int(job.get('pauseMs', 2500))
    max_pages = int(job.get('maxPages', 0) or 0)

    log(job_id, '******** 服务端 ********')
    words = job.get('words') or []
    # 关键词模式：一级词 + 二级词列表 → 搜索 → 笔记 → 评论
    if not urls and keyword:
        combo = [keyword] + [w for w in words if w and w != keyword]
        per_word = int(job.get('notesPerWord', 3))
        search_pages = max_pages or 3
        log(job_id, f'关键词搜索任务：一级「{keyword}」+ 二级 {len(combo) - 1} 词，每词最多采集 {per_word} 篇笔记评论')
        all_urls = []
        with launch_persistent_context(PROFILE, headless=True) as ctx:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            for i, kw in enumerate(combo):
                log(job_id, f'〔搜索 {i + 1}/{len(combo)}〕关键词「{kw}」…')
                try:
                    links = search_notes(page, kw, max_pages=search_pages, per_word=max(per_word, 1))
                    log(job_id, f'搜索「{kw}」命中 {len(links)} 篇笔记')
                    all_urls.extend(links)
                except Exception as e:
                    log(job_id, f'搜索「{kw}」失败：{e}')
        # 全局去重（保持顺序）
        seen = set()
        dedup = []
        for u in all_urls:
            key = u.split('/explore/')[1].split('?')[0] if '/explore/' in u else u
            if key not in seen:
                seen.add(key)
                dedup.append(u)
        log(job_id, f'笔记去重后共 {len(dedup)} 篇，开始逐帖采集评论')
        content_filter = job.get('contentFilter', '')  # 评论内容过滤词独立于搜索词（搜索词≠过滤词）
        with launch_persistent_context(PROFILE, headless=True) as ctx:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            for i, url in enumerate(dedup):
                log(job_id, f'[{i + 1}/{len(dedup)}] 开始采集 {note_id_of(url)}')
                try:
                    n, total, path = crawl_page(page, url, content_filter, pause_ms, max_pages, meta={'job_id': job_id, 'keyword': keyword})
                    log(job_id, f'完成 {note_id_of(url)}：{n} 条（原始 {total} 条）→ {os.path.basename(path)}')
                except Exception as e:
                    log(job_id, f'失败 {url[:40]}：{e}')
        log(job_id, '【任务完成】****************************')
        return

    if not urls:
        log(job_id, f'任务无数据源（无链接且无关键词），退出')
        return
    log(job_id, f'任务启动（{len(urls)} 帖，关键词筛选: {keyword or "无"}，增量页数上限: {max_pages or "全部"}）')
    with launch_persistent_context(PROFILE, headless=True) as ctx:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        for i, url in enumerate(urls):
            log(job_id, f'[{i + 1}/{len(urls)}] 开始采集 {note_id_of(url)}')
            try:
                n, total, path = crawl_page(page, url, keyword, pause_ms, max_pages, meta={'job_id': job_id, 'keyword': keyword})
                log(job_id, f'完成 {note_id_of(url)}：{n} 条（原始 {total} 条）→ {os.path.basename(path)}')
            except Exception as e:
                log(job_id, f'失败 {url[:40]}：{e}')
    log(job_id, '【任务完成】****************************')


if __name__ == '__main__':
    main()
