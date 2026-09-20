// scripts/record-asset.mjs —— 素材演示录制器（008 侧，零依赖）
// 素材渲染链路 B 方案：headless Chrome 加载素材（auto 参数驱动演示）→ CDP 逐帧截图 → ffmpeg 合成 mp4。
// 用法：node scripts/record-asset.mjs <素材名> [--duration 7] [--fps 10] [--speed 0.25] [--size 640x360] [--delay 400] [--out 输出.mp4]
//   默认输出到素材库目录：工作台素材/<素材名>/demo.mp4（素材自包含）
// 要点：headless 截图慢（~0.2-0.6s/帧），必须用 --speed 把素材动画调慢到覆盖整个录制窗口，
//   否则动画在头几帧一闪而过（视频看似静态）。slow 素材动画 + 均匀拍帧 = 视频里完整开合一轮。
// 依赖：系统 Chrome（CHROME_PATH 可覆盖）、ffmpeg（PATH）、Node ≥22（原生 WebSocket）
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIBE_ASSETS = resolve(import.meta.dirname, '..', '..', 'project_007_VibeMotion联动', '工作台素材');

const argv = process.argv.slice(2);
const asset = argv.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const duration = parseFloat(opt('duration', '7'));    // 秒——录制窗口须 ≥ 完整开合轮（auto 关在 ~3.6-4s + 关动画/speed）
const fps = parseInt(opt('fps', '10'), 10);
const speed = parseFloat(opt('speed', '0.25'));       // 素材动画速度倍率：调慢以覆盖录制窗口（0.25 = 慢 4 倍）
const [vw, vh] = (opt('size', '640x360') || '640x360').split('x').map((s) => parseInt(s, 10));
const delay = parseInt(opt('delay', '400'), 10);      // load 后等 ms 再开拍（等 gsap/auto 就绪）
if (!asset) { console.error('usage: node scripts/record-asset.mjs <素材名> [--duration 7] [--fps 10] [--speed 0.25] [--size 640x360] [--delay 400] [--out xx.mp4]'); process.exit(1); }

const indexHtml = join(VIBE_ASSETS, asset, 'index.html');
if (!existsSync(indexHtml)) { console.error(`素材不存在或缺少 index.html: ${indexHtml}`); process.exit(1); }
const outFile = resolve(opt('out', join(VIBE_ASSETS, asset, 'demo.mp4')));
const frameDir = join(process.env.TEMP || '/tmp', `rec-${asset}-${Date.now()}`);
mkdirSync(frameDir, { recursive: true });

// 演示 URL：file:// + auto 参数（素材标准化已支持）；speed 调慢覆盖录制窗口
const url = pathToFileURL(indexHtml).href + `?auto=true&speed=${speed}`;

// ── 最小 CDP 客户端（Node 原生 WebSocket，零依赖）──
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); // send 前必须等连接就绪
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method && listeners.has(m.method)) listeners.get(m.method).forEach((cb) => cb(m.params));
  };
  return {
    async send(method, params = {}) {
      await ready;
      return new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, cb) { listeners.set(method, [...(listeners.get(method) || []), cb]); },
    close() { ws.close(); },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 启动 headless Chrome（固定端口 + HTTP 探活）──
const port = 9400 + Math.floor(Math.random() * 200);
const userData = join(process.env.TEMP || '/tmp', `rec-cdp-${Date.now()}`);
// 反节流三连：headless 下后台 rAF/定时器会被节流，gsap 动画会停住（录制内容成静态画面）
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--window-size=${vw},${vh}`, '--hide-scrollbars', '--disable-gpu', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--user-data-dir=${userData}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'inherit'] });

async function waitTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* chrome 未就绪 */ }
    await sleep(200);
  }
  throw new Error('Chrome 启动超时');
}

// ── 主流程 ──
const wsUrl = await waitTarget();
const client = cdp(wsUrl);
console.log(`[record] ${asset} → ${outFile}（${duration}s @ ${fps}fps，delay ${delay}ms）`);
await client.send('Page.enable');
// 精确控制视口尺寸（--window-size 与实际截图视口有偏差，libx264 要求偶数尺寸）
await client.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
await client.send('Page.navigate', { url });
await new Promise((res) => { client.on('Page.loadEventFired', res); });
await sleep(delay);

const total = Math.round(duration * fps);
const interval = Math.round(1000 / fps);
for (let i = 1; i <= total; i++) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(frameDir, `frame_${String(i).padStart(4, '0')}.png`), Buffer.from(shot.data, 'base64'));
  await sleep(interval); // 串行拍帧：帧间隔 = 截图耗时 + interval（动画时间真实流逝，速率略漂可接受）
}
console.log(`[record] 已拍 ${total} 帧 → ffmpeg 合成`);

execFileSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', join(frameDir, 'frame_%04d.png'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile], { stdio: 'inherit' });
console.log(`[record] 完成：${outFile}（${(await import('node:fs')).statSync(outFile).size / 1024 / 1024 | 0}MB）`);

client.close();
chrome.kill();
rmSync(frameDir, { recursive: true, force: true });
rmSync(userData, { recursive: true, force: true });
