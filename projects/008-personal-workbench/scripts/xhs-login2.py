# xhs-login2.py —— 小红书登录（v2：真登录检测——fetch profile 判断 URL 是否跳登录页）
# 窗口保持打开，直到检测到真实登录态；登录成功自动保存档案并退出。
import time, os
from cloakbrowser import launch_persistent_context

PROFILE = os.path.join(os.path.expanduser('~'), '.cloakbrowser', 'profiles', 'xhs')
os.makedirs(PROFILE, exist_ok=True)

print('启动 CloakBrowser 窗口——请在弹出的浏览器里登录小红书（扫码/手机号均可）...')
ctx = launch_persistent_context(PROFILE, headless=False)
page = ctx.pages[0] if ctx.pages else ctx.new_page()
page.goto('https://www.xiaohongshu.com/')
page.wait_for_timeout(8000)
print('窗口已打开。登录完成后无需点击任何按钮——检测到登录态后我会自动保存并关闭窗口。')


def is_logged_in(p):
    # 真伪标准：页面内 fetch /user/profile，若响应最终 URL 落在 /login 则未登录
    try:
        r = p.evaluate(
            "async () => { const res = await fetch('/user/profile', { redirect: 'follow' }); return { url: res.url, status: res.status }; }"
        )
        return '/login' not in (r.get('url') or '')
    except Exception:
        return False


start = time.time()
ok = False
while time.time() - start < 900:  # 窗口最多等 15 分钟
    time.sleep(8)
    if is_logged_in(page):
        ok = True
        break
    el = int(time.time() - start)
    if el % 60 < 8:
        print(f'[login] 等待登录中... {el}s（窗口未关，请扫码或手机号登录）')

time.sleep(5)
try:
    ctx.close()
except Exception as e:
    print('[login] close 异常（不影响持久化）:', e)
print('[login] 结果:', 'LOGIN OK - 档案已保存' if ok else 'TIMEOUT - 未检测到登录')
