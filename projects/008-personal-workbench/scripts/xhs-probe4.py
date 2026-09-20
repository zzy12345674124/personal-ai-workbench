# xhs-probe4.py —— 探测 v4：被动收集（监听页面自身评论接口响应）+ 滚动分页，测未登录上限
# 用法：python scripts/xhs-probe4.py "note_url"
import sys, json, os
from cloakbrowser import launch

NOTE = sys.argv[1]
JOURNAL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'runs', 'anonymous-page-probe.jsonl')


def main():
    with launch(headless=True) as browser:
        page = browser.new_page()

        def on_response(resp):
            # 同步 Playwright：回调必须是同步函数（resp.json()/text() 同步可用）
            if 'comment/page' in resp.url and resp.status == 200:
                try:
                    j = json.loads(resp.text())
                    with open(JOURNAL, 'a', encoding='utf-8') as f:
                        n = len((j.get('data') or {}).get('comments') or [])
                        cursor = (j.get('data') or {}).get('cursor', '')
                        more = (j.get('data') or {}).get('has_more')
                        f.write(json.dumps({'page_cursor': cursor, 'n': n, 'has_more': more, 'sample': ((j.get('data') or {}).get('comments') or [{}])[0].get('content', '')[:40] if n else ''}, ensure_ascii=False) + '\n')
                except Exception:
                    pass

        page.on('response', on_response)
        page.goto(NOTE, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(6000)
        # 滚动触发评论分页加载
        for i in range(6):
            page.mouse.wheel(0, 2000)
            page.wait_for_timeout(3000)
        # 点「展开更多回复」尝试
        try:
            page.click('text=展开', timeout=3000)
            page.wait_for_timeout(3000)
        except Exception:
            pass
        browser.close()

    print('=== 落盘接口响应摘要 ===')
    try:
        total = 0
        for line in open(JOURNAL, encoding='utf-8'):
            d = json.loads(line)
            total += d.get('n', 0)
            print(f"  n={d['n']} has_more={d.get('has_more')} cursor={str(d.get('page_cursor'))[:12]} sample={str(d.get('sample'))[:30]}")
        print('总条数(未登录可能含重复):', total)
    except FileNotFoundError:
        print('无落盘——接口没有捕捉到（可能未登录无请求）')


if __name__ == '__main__':
    main()
