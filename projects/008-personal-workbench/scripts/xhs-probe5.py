# xhs-probe5.py —— 探测 v5：定位评论滚动容器并滚动到底（贴卡片滚动），触发分页收集
import sys, json, os
from cloakbrowser import launch

NOTE = sys.argv[1]
JOURNAL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'runs', 'anonymous-page-probe-2.jsonl')


def main():
    with launch(headless=True) as browser:
        page = browser.new_page()

        def on_response(resp):
            if 'comment/page' in resp.url and resp.status == 200:
                try:
                    j = json.loads(resp.text())
                    n = len((j.get('data') or {}).get('comments') or [])
                    with open(JOURNAL, 'a', encoding='utf-8') as f:
                        f.write(json.dumps({'n': n, 'has_more': (j.get('data') or {}).get('has_more'), 'cursor': (j.get('data') or {}).get('cursor', '')[:14], 'sample': ((j.get('data') or {}).get('comments') or [{}])[0].get('content', '')[:30] if n else ''}, ensure_ascii=False) + '\n')
                except Exception:
                    pass

        page.on('response', on_response)
        page.goto(NOTE, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(6000)

        # 定位可滚动容器（评论所在的 overflow 元素）并滚到底
        for i in range(8):
            info = page.evaluate(
                """() => {
                  const els = [...document.querySelectorAll('div,section')].filter(e =>
                    e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200);
                  if (!els.length) return { found: 0 };
                  // 取滚动最大且含评论相邻的容器
                  let best = els[0];
                  for (const e of els) if (e.scrollHeight > best.scrollHeight) best = e;
                  best.scrollTop = best.scrollHeight;
                  return { found: els.length, sh: best.scrollHeight, ch: best.clientHeight };
                }"""
            )
            page.wait_for_timeout(3000)
            if i == 0:
                print('滚动容器:', info)
        # 键盘 End 兜底
        page.keyboard.press('End')
        page.wait_for_timeout(4000)
        browser.close()

    print('=== 分页收集摘要 ===')
    try:
        for line in open(JOURNAL, encoding='utf-8'):
            d = json.loads(line)
            print(f"  n={d['n']} more={d.get('has_more')} cursor={d.get('cursor')} sample={d.get('sample')}")
    except FileNotFoundError:
        print('无落盘')


if __name__ == '__main__':
    main()
