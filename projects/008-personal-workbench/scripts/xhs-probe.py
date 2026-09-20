# xhs-probe.py —— 小红书评论爬取·第一步探测：页面可达性 + 评论 DOM 结构
# 用法：python scripts/xhs-probe.py [note_url]（不传则先探首页）
import sys
from cloakbrowser import launch

HOME = 'https://www.xiaohongshu.com/explore'
headless = False if '--headful' in sys.argv else True


def probe(page, url, label):
    try:
        page.goto(url, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(5000)
    except Exception as e:
        print(f'[{label}] 打开异常: {e}')
        return
    title = page.title()
    final = page.url
    print(f'[{label}] 标题: {title[:50]}')
    print(f'[{label}] URL: {final[:80]}')
    if 'login' in final.lower() or 'login' in title.lower():
        print(f'[{label}] ⚠️ 陷入登录页')
    # 页面文本量（判断是否空壳）
    txt = page.inner_text('body').strip()
    print(f'[{label}] body 文本长度: {len(txt)}（字符）')
    # 评论区容器探测：所有含文本「评论」的元素 class 采样
    com = page.evaluate(
        """() => {
          const out = [];
          const all = document.querySelectorAll('div,section');
          for (const el of all) {
            if (out.length > 12) break;
            const t = (el.childElementCount === 0 ? el.innerText : '').trim();
            if (t.length > 0 && t.length < 12 && /评论/.test(t)) {
              out.push({ tag: el.tagName, cls: el.className && String(el.className).slice(0, 60) });
            }
          }
          return out;
        }"""
    )
    print(f'[{label}] 含「评论」文字的叶节点:')
    for c in com[:10]:
        print('   ', c.get('tag'), '| ', str(c.get('cls'))[:60])


def main():
    with launch(headless=headless) as browser:
        page = browser.new_page()
        if len(sys.argv) > 1 and 'http' in sys.argv[1]:
            probe(page, sys.argv[1], 'note')
        else:
            probe(page, HOME, 'home')
            # 尝试从首页找一个笔记链接
            links = page.evaluate(
                "() => [...document.querySelectorAll('a')].map(a => a.href).filter(h => /explore\\/|discovery\\/item\\//.test(h)).slice(0,3)"
            )
            print('[home] 笔记链接候选:', links[:3])
            if links:
                probe(page, links[0], 'first-note')
        browser.close()


if __name__ == '__main__':
    main()
