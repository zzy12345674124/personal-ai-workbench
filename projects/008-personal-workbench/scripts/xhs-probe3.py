# xhs-probe3.py —— 探测 v3：未登录下官方评论接口的分页能力（拿 JSON 条数与 cursor）
# 用法：python scripts/xhs-probe3.py "note_url_with_token"
import sys, json
from cloakbrowser import launch

NOTE = sys.argv[1]
API = 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page'
NOTE_ID = NOTE.split('/explore/')[1].split('?')[0] if '/explore/' in NOTE else NOTE.split('?')[0]


def main():
    with launch(headless=True) as browser:
        page = browser.new_page()
        page.goto(NOTE, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(5000)
        # 页面内 fetch 评论接口（页面上下文自带 x-s 签名），翻 3 页
        for page_no in range(3):
            res = page.evaluate(
                """async ({api, note_id, cursor}) => {
                  try {
                    const r = await fetch(api + '?note_id=' + note_id + '&cursor=' + cursor + '&top_comment_id=&image_formats=webp,avif&xsec_token=' +
                      (new URLSearchParams(location.search).get('xsec_token') || ''), { credentials: 'include' });
                    const j = await r.json();
                    return { ok: r.ok, code: j.code, msg: j.msg, data: j.data };
                  } catch (e) { return { err: String(e) }; }
                }""",
                {'api': API, 'note_id': NOTE_ID, 'cursor': '' if page_no == 0 else None},
            )
            if page_no > 0:
                # 用上一页返回的 cursor
                res = page.evaluate(
                    """async ({api, note_id, cursor, xtoken}) => {
                      const r = await fetch(api + '?note_id=' + note_id + '&cursor=' + cursor + '&top_comment_id=&image_formats=webp,avif' + (xtoken ? '&xsec_token=' + xtoken : ''), { credentials: 'include' });
                      return await r.json();
                    }""",
                    {'api': API, 'note_id': NOTE_ID, 'cursor': last_cursor, 'xtoken': xtoken},
                )
            if 'err' in res:
                print(f'page{page_no}: fetch err {res["err"][:100]}')
                break
            data = res.get('data') or {}
            comments = data.get('comments') or []
            print(f'page{page_no}: code={res.get("code")} 条数={len(comments)} cursor={data.get("cursor", "")[:10]}… hasMore={data.get("has_more")}')
            if comments:
                c = comments[0]
                print('  首条评论:', {
                    'id': c.get('id', ''), 'nick': (c.get('user_info') or {}).get('nickname', ''),
                    'content': (c.get('content') or '')[:30], 'likes': c.get('like_count'),
                    'ip': (c.get('ip_location') or ''), 'time': c.get('create_time'),
                })
            if not comments:
                print('  raw data keys:', list(data.keys())[:10])
                break
            if not data.get('has_more'):
                print('has_more=false，分页结束')
                break
            last_cursor = data.get('cursor', '')
            import urllib.parse
            xtoken = urllib.parse.parse_qs(NOTE.split('?')[1] if '?' in NOTE else '').get('xsec_token', [''])[0]
        browser.close()


if __name__ == '__main__':
    main()
