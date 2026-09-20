# cloak-test.py —— CloakBrowser 核心验证（本地检测页版，不依赖外网）
# 用法：python scripts/cloak-test.py [外网检测URL]
# 默认加载本地 cloak-detector.html（file://），全部指纹检测在本地完成，确定性高。
import os
import cloakbrowser

DETECTOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cloak-detector.html')


def main():
    browser = cloakbrowser.launch(headless=True)
    page = browser.new_page()
    page.goto('file:///' + DETECTOR.replace('\\', '/'), wait_until='load', timeout=30000)
    raw = page.inner_text('#out')
    print('=== 本地指纹检测结果 ===')
    print(raw)
    browser.close()
    # 简洁判定
    lines = dict(
        l.split(': ', 1) for l in raw.strip().splitlines() if ': ' in l
    )
    webdriver = lines.get('webdriver', '?')
    has_chrome = lines.get('hasChrome', '?')
    ok = webdriver == 'false' and has_chrome == 'true'
    print(f'判定: webdriver={webdriver} | hasChrome={has_chrome} | {"PASS" if ok else "FAIL"}')


if __name__ == '__main__':
    main()
