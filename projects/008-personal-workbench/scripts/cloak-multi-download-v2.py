# cloak-multi-download-v2.py —— v2：先取签名 CDN URL，再分段下载（无重定向，Range 必生效），sha256 校验
import subprocess, concurrent.futures, os, time, hashlib, urllib.request

API = 'https://api.github.com/repos/CloakHQ/cloakbrowser/releases/assets/425794331'
EXPECT = 'b213795cb32c3169f766c74ce1d0275fc89d3df256de39c04da7fb4c23b7fdbe'
SIZE = 535 * 1024 * 1024  # 560,988,160
SEG = 8
OUT_DIR = os.path.join(os.path.expanduser('~'), 'Downloads')
ZIP = os.path.join(OUT_DIR, 'cloakbrowser-windows-x64.zip')

# 1. 取签名 URL（curl -w redirect_url 拿 302 Location，不跟随、不下载）
def signed_url():
    for attempt in range(5):
        try:
            r = subprocess.run(
                ['curl', '-s', '-m', '15', '-o', '/dev/null',
                 '-H', 'Accept: application/octet-stream', '-H', 'User-Agent: curl',
                 '-w', '%{redirect_url}', API],
                capture_output=True, text=True, check=False)
            url = r.stdout.strip()
            if url.startswith('http'):
                return url
        except Exception:
            pass
        time.sleep(5)
    raise RuntimeError('无法获取签名 URL')

url = signed_url()
print('签名 URL 已获取（前 80 字符）:', url[:80])

def dl(i):
    start = i * SIZE // SEG
    end = (i + 1) * SIZE // SEG - 1
    part = os.path.join(OUT_DIR, f'cb2.part.{i}')
    subprocess.run(
        ['curl', '-s', '--retry', '3', '--retry-all-errors', '-m', '2400',
         '-r', f'{start}-{end}', '-o', part, url],
        timeout=2700, check=False)
    size = os.path.getsize(part) if os.path.exists(part) else 0
    want = SIZE // SEG
    print(f'  part {i}: {size}/{want} {"OK" if size == want else "FAIL"}')
    return size == want

t0 = time.time()
with concurrent.futures.ThreadPoolExecutor(SEG) as ex:
    results = list(ex.map(dl, range(SEG)))
print(f'8 段完成（{time.time() - t0:.0f}s），合并...')

with open(ZIP, 'wb') as f:
    for i in range(SEG):
        with open(os.path.join(OUT_DIR, f'cb2.part.{i}'), 'rb') as p:
            f.write(p.read())

# 2. sha256 校验
h = hashlib.sha256()
with open(ZIP, 'rb') as f:
    for chunk in iter(lambda: f.read(1 << 20), b''):
        h.update(chunk)
got = h.hexdigest()
print('本地 sha256:', got)
print('官方 sha256:', EXPECT)
if got == EXPECT:
    print('✅ SHA256 校验通过')
else:
    print('❌ 校验失败——请重跑')
for i in range(SEG):
    os.remove(os.path.join(OUT_DIR, f'cb2.part.{i}'))
print('分段已清理')
