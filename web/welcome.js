// web/welcome.js —— 欢迎界面（首次加载全屏覆盖：一句欢迎语 + 自动关闭）
// 淡入淡出用 CSS 过渡（不依赖 gsap）；标题乱码还原动效用 scramble.js（无 gsap 时库内降级）。
// 仅首次显示（localStorage 记忆）；默认行为不变——浮层背后已进第一个工具，淡出即见。
// 注意：gsap/scrambleText 由 index.html 经典 <script> 加载（window 全局），
// 不得 ESM import vendor（UMD 在模块上下文会抛，见 nav-fullscreen.js 注释）。
const WELCOME_KEY = 'wb.publicDemo.welcomeSeen';
const FADE_MS = 400;     // 淡入时长
const SHOW_MS = 1500;    // 从打开到开始淡出（用户要求 1-2 秒，落在区间内）
const FADE_OUT_MS = 500; // 淡出时长

export function mountWelcome() {
  const host = document.getElementById('welcomeHost');
  if (!host) return;
  try { if (localStorage.getItem(WELCOME_KEY)) return; } catch { return; } // 隐私模式等存储异常一律不弹
  host.innerHTML = `
    <div class="welcome-overlay">
      <div class="welcome-card">
        <h1 class="welcome-title" id="welcomeTitle">欢迎查看个人工作台</h1>
      </div>
    </div>`;
  const overlay = host.querySelector('.welcome-overlay');
  const close = () => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* 存储不可用时仅本次不弹 */ }
    overlay.classList.remove('welcome-show'); // 触发淡出过渡
    setTimeout(() => { host.innerHTML = ''; }, FADE_OUT_MS + 100); // 过渡结束兜底移除
  };
  // 淡入：双 rAF 确保初始 opacity:0 已应用后再加 .welcome-show，否则过渡不触发
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('welcome-show')));
  // 开门动效：标题逐字乱码还原（scramble.js 预留用途；无 gsap 时库内部降级为直接显示原文）
  if (window.scrambleText) window.scrambleText(host.querySelector('#welcomeTitle'), '欢迎查看个人工作台', { duration: 1.1 });
  setTimeout(close, FADE_MS + SHOW_MS);
}
