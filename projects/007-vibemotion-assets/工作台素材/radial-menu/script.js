// ── 参数化标准化（2026-08-08）：读 URL 参数覆盖默认配置；不传参时与原版行为一致 ──
// 通用：speed=动画速度倍率(1=原速,2=快一倍,0.5=慢一倍) | accent=主题强调色(hex) | auto=加载自动演示开合
// 特有：radius=展开半径px | title=标题文字
const _P = new URLSearchParams(location.search);
const _num = (k, fb, min, max) => { const v = parseFloat(_P.get(k)); return isFinite(v) ? Math.min(max, Math.max(min, v)) : fb; };
const CFG = {
  speed: _num('speed', 1, 0.1, 5),
  accent: /^#[0-9a-fA-F]{3,6}$/.test(_P.get('accent') || '') ? _P.get('accent') : '',
  auto: !(_P.get('auto') === 'false' || _P.get('auto') === '0'),
  radius: _num('radius', 120, 60, 400),
  title: (_P.get('title') || '').slice(0, 40),
};
if (CFG.accent) document.documentElement.style.setProperty('--color-shockingly-green', CFG.accent);
if (CFG.title) document.querySelector('h1').textContent = CFG.title;

const items = gsap.utils.toArray(".fab-item");
const radius = CFG.radius;
const startAngle = 180;
const endAngle = 270;
const angleStep = (endAngle - startAngle) / (items.length - 1);
let tl,
  isOpen = false;

const easeToggle = document.querySelector("#easeToggle");
const easeSelect = document.querySelector("#easeSelect");
const speedSlider = document.querySelector("#speedSlider");
const speedVal = document.querySelector("#speedVal");

speedSlider.addEventListener("input", () => {
  speedVal.textContent = parseFloat(speedSlider.value).toFixed(1) + "x";
});

easeToggle.addEventListener("change", (e) => {
  const on = e.target.checked;
  document.querySelector("#toggleLabel").classList.toggle("is-active", on);
  easeSelect.disabled = !on;
  buildTimeline();
});

easeSelect.addEventListener("change", () => {
  buildTimeline();
});

function getEaseReverse() {
  if (!easeToggle.checked) return false;
  const val = easeSelect.value;
  return val === "true" ? true : val;
}

function buildTimeline() {
  if (tl) tl.kill();
  gsap.set(".fab-item", { x: 0, y: 0, scale: 0, opacity: 0 });

  const erVal = getEaseReverse();
  tl = gsap.timeline({ paused: true });

  items.forEach((item, i) => {
    const angle = (startAngle + angleStep * i) * (Math.PI / 180);
    const tx = Math.cos(angle) * radius;
    const ty = Math.sin(angle) * radius;
    tl.to(
      item,
      {
        x: tx,
        y: ty,
        scale: 1,
        opacity: 1,
        duration: 0.6,
        ease: "elastic.out(1, 0.5)",
        easeReverse: erVal
      },
      i * 0.05
    );
  });

  tl.to(
    "#fabBtn svg",
    {
      rotation: 135,
      duration: 0.35,
      ease: "back.out(1.7)",
      easeReverse: erVal
    },
    0
  );

  tl.to("#status", { opacity: 1, duration: 0.2 }, 0);

  isOpen = false;
  document.querySelector("#fabBtn").setAttribute("aria-expanded", "false");
}

buildTimeline();

function toggle() {
  const speed = parseFloat(speedSlider.value);
  if (isOpen) {
    const erVal = getEaseReverse();
    tl.timeScale(speed * CFG.speed).reverse();
    document.querySelector("#fabBtn").setAttribute("aria-expanded", "false");
  } else {
    const erVal = getEaseReverse();
    tl.timeScale(CFG.speed).play();
    document.querySelector("#fabBtn").setAttribute("aria-expanded", "true");
  }
  isOpen = !isOpen;
}

document.querySelector("#fabBtn").addEventListener("click", toggle);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isOpen) toggle();
});

// auto 参数：加载后自动演示一轮开合（预览器调参立即可见）
if (CFG.auto) {
  setTimeout(toggle, 600);
  setTimeout(() => { if (isOpen) toggle(); }, 3600);
}
