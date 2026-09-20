# xhs-probe2.py —— 探测 v2：滚动加载评论 + 拦截评论接口响应（双路线）
# 用法：python scripts/xhs-probe2.py "note_url"
import sys
from cloakbrowser import launch

NOTE = sys.argv[1] if len(sys.argv) > 1 else None
assert NOTE, '需要笔记 URL'

captured = []


def main():
    with launch(headless=True) as browser:
        page = browser.new_page()
        # 监听评论接口响应（api/sns/web/v2/comment 或 comment/page）
        page.on('response', lambda r: captured.append(r) if 'comment' in r.url and ('page' in r.url or 'comment' in r.url) else None)
        page.goto(NOTE, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(6000)
        # 滚动到底部触发评论加载
        for _ in range(4):
            page.mouse.wheel(0, 2400)
            page.wait_for_timeout(2000)
        print('=== 评论接口响应捕获 ===')
        hits = [r for r in captured if 'comment' in r.url]
        for r in hits[:5]:
            print(' ', r.status, r.url[:110])
        # HTML 侧：评论容器候选（cls 含 comment / note-window / 评论区）
        containers = page.evaluate(
            """() => {
              const out = [];
              document.querySelectorAll('[class*="comment"],[class*="note-window"],[class*="chat"]').forEach(el => {
                const t = (el.innerText || '').slice(0, 40).replace(/\\s+/g, ' ');
                if (t.includes('评论') || /\\d+/.test(t)) {
                  if (out.length < 15) out.push({ cls: String(el.className).slice(0,80), txt: t, kids: el.childElementCount });
                }
              });
              return out;
            }"""
        )
        print('=== DOM 评论候选节点 ===')
        for c in containers:
            print(' ', c)
        # 评论数总览（页面文本里提取）
        body = page.inner_text('body')
        for kw in ('评论', '赞'):
            i = body.find(kw)
        print('=== 页面含评论字样上下文 ===')
        import re
        for m in re.finditer('评论', body):
            seg = body[max(0, m.start()-30):m.start()+20].replace('\n', ' ')
            print('  …', seg)
        browser.close()


if __name__ == '__main__':
    main()
