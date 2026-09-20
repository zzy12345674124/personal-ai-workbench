// ── 参数化标准化（2026-08-08）：读 URL 参数覆盖默认配置；不传参时与原版行为一致 ──
// 通用：speed=动画速度倍率(1=原速,2=快一倍,0.5=慢一倍) | accent=主题强调色(hex) | auto=加载自动演示开合
// 特有：width=展开宽度px | links=菜单项文字(逗号分隔,覆盖顺序对应,保留序号)
const _P = new URLSearchParams(location.search);
const _num = (k, fb, min, max) => { const v = parseFloat(_P.get(k)); return isFinite(v) ? Math.min(max, Math.max(min, v)) : fb; };
const CFG = {
  speed: _num('speed', 1, 0.1, 5),
  accent: /^#[0-9a-fA-F]{3,6}$/.test(_P.get('accent') || '') ? _P.get('accent') : '',
  auto: !(_P.get('auto') === 'false' || _P.get('auto') === '0'),
  width: _num('width', 0, 200, 800),
  links: (_P.get('links') || '').slice(0, 80),
};
if (CFG.accent) document.documentElement.style.setProperty('--color-shockingly-green', CFG.accent);
// links 参数：覆盖菜单项文字（逗号分隔，按顺序；超出的项不动）
if (CFG.links) {
  const names = CFG.links.split(',').map((s) => s.trim()).filter(Boolean);
  document.querySelectorAll('.menu-link > span:first-child').forEach((el, i) => {
    if (names[i]) el.textContent = names[i];
  });
}

let isOpen = false;
let exitSpeed = 1;
const toggleEl = document.querySelector('#easeReverse');
const exitSlider = document.querySelector('#exitSpeed');
const exitLabel = document.querySelector('#exitSpeedVal');
const island = document.querySelector('.island');
const expandedWidth = CFG.width || Math.min(window.innerWidth * 0.9, 400);
let tl;

function init() {
  tl && tl.revert();
  const er = toggleEl.checked;
  tl = gsap.timeline({ paused: true })
    .set('.menu-overlay', { pointerEvents: 'auto' })
    .to('.island', { width: expandedWidth, duration: 0.8, ease: 'back.out(2)', easeReverse: er ? 'power2.out' : false }, 0)
    .to('.island-logo', { opacity: 1, rotation: 180, duration: 0.5, ease: 'back.out', easeReverse: er ? 'power4.out' : false }, 0.12)
    .to('.bar-mid', { opacity: 0, duration: 0.15, ease: 'power2.in', easeReverse: er }, 0)
    .to('.bar-top', { attr: { x1: 3, y1: 3, x2: 13, y2: 13 }, duration: 0.28, ease: 'power3.inOut' }, 0)
    .to('.bar-bot', { attr: { x1: 13, y1: 3, x2: 3, y2: 13 }, duration: 0.28, ease: 'power3.inOut' }, 0)
    .to('.menu-backdrop', { opacity: 1, duration: 0.3, ease: 'power2.out' }, 0)
    .from('.menu-panel', { autoAlpha: 0, yPercent: -10, scale: 0.6, duration: 0.8, transformOrigin: 'top center', ease: 'back.out(2)', easeReverse: er ? 'power3.out' : false }, 0.1)
    .from('.menu-link', { opacity: 0, y: 6, duration: 0.32, ease: 'power2.out', easeReverse: er, stagger: 0.05 }, 0.22);
}
init();

toggleEl.addEventListener('change', () => {
  if (isOpen) {
    isOpen = false;
    document.getElementById('menuToggle').setAttribute('aria-expanded', false);
  }
  init();
});

exitSlider.addEventListener('input', () => {
  exitSpeed = parseFloat(exitSlider.value);
  exitLabel.textContent = exitSpeed + '×';
});

function toggle() {
  isOpen = !isOpen;
  const btn = document.getElementById('menuToggle');
  btn.setAttribute('aria-expanded', isOpen);
  btn.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  document.querySelectorAll('.menu-link').forEach(l => l.setAttribute('tabindex', isOpen ? '0' : '-1'));
  if (isOpen) {
    tl.timeScale(CFG.speed).play();
  } else {
    tl.eventCallback('onReverseComplete', () => gsap.set('.menu-overlay', { pointerEvents: 'none' }));
    tl.timeScale(exitSpeed * CFG.speed).reverse();
  }
}

document.getElementById('menuToggle').addEventListener('click', toggle);
document.querySelector('.menu-backdrop').addEventListener('click', () => { if (isOpen) toggle(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isOpen) { toggle(); document.getElementById('menuToggle').focus(); }
});
document.querySelector('.menu-overlay').addEventListener('keydown', e => {
  if (!isOpen || e.key !== 'Tab') return;
  const focusable = [...document.querySelectorAll('.menu-link[tabindex="0"]')];
  if (!focusable.length) return;
  const [first, last] = [focusable[0], focusable[focusable.length - 1]];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// auto 参数：加载后自动演示一轮开合（预览器调参立即可见）
if (CFG.auto) {
  setTimeout(toggle, 600);
  setTimeout(() => { if (isOpen) toggle(); }, 4000);
}