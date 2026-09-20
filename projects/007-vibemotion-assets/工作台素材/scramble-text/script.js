// 乱码文字参数化素材 —— 读 URL 参数驱动乱码还原动画（素材库「支持 URL 参数」标准首个素材）
// 参数：text=内容(默认 个人工作台) | speed=速度倍率(默认 1,2=快一倍,0.5=慢一倍) |
//       repeat=是否循环(默认 true,可 false/0) | size=字号px(默认 64) |
//       color=文字色(默认 #0ae448) | bg=背景色(默认 #0e100f)
// 工作台素材预览器「参数调节」面板填入 key=value → 应用 → iframe URL 带参刷新，本素材即时生效。
const GLYPHS = '!<>-_\\/[]{}—=+*^?#________';

(function () {
  const P = new URLSearchParams(location.search);
  const num = (k, fallback, min, max) => {
    const v = parseFloat(P.get(k));
    if (!isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  };
  const cfg = {
    text: (P.get('text') || '个人工作台').slice(0, 40),
    speed: num('speed', 1, 0.1, 5),               // 速度倍率：1=原速，2=快一倍，0.5=慢一倍
    repeat: !(P.get('repeat') === 'false' || P.get('repeat') === '0'),
    size: Math.round(num('size', 64, 16, 200)),
    color: /^#[0-9a-fA-F]{3,6}$/.test(P.get('color') || '') ? P.get('color') : '#0ae448',
    bg: /^#[0-9a-fA-F]{3,6}$/.test(P.get('bg') || '') ? P.get('bg') : '#0e100f',
  };

  // 参数应用到页面
  const title = document.getElementById('scrambleTitle');
  document.body.style.background = cfg.bg;
  title.style.fontSize = `${cfg.size}px`;
  title.style.color = cfg.color;
  title.style.textShadow = `0 0 24px ${cfg.color}33`;
  document.getElementById('cfgInfo').textContent =
    `text=${cfg.text} · speed=${cfg.speed} · repeat=${cfg.repeat} · size=${cfg.size} · color=${cfg.color} · bg=${cfg.bg}`;

  // 乱码还原动画（与 008 web/vendor/scramble.js 同构，自包含版；repeat 循环由 gsap timeline 驱动）
  const randomize = (ch, rng) => (ch === ' ' ? ' ' : GLYPHS[Math.floor(rng() * GLYPHS.length)]);
  const targets = cfg.text.split('');
  const props = targets.map(() => ({ revealed: 0 }));
  let seed = 1;
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const tick = () => {
    title.textContent = targets.map((ch, i) => (props[i].revealed >= 1 ? ch : randomize(ch, rng))).join('');
  };

  const play = () => {
    props.forEach((p) => (p.revealed = 0));
    const perCharDur = 0.08 / cfg.speed; // 基准每字符 0.08s ÷ 速度倍率（快→时长短）
    const tl = gsap.timeline({ onUpdate: tick, repeat: cfg.repeat ? -1 : 0, repeatDelay: cfg.repeat ? 1.2 : 0 });
    targets.forEach((_, i) => {
      tl.to(props[i], { revealed: 1, duration: perCharDur, ease: 'power2.out' }, i * perCharDur * 0.6);
    });
    if (cfg.repeat) tl.eventCallback('onRepeat', () => props.forEach((p) => (p.revealed = 0)));
    tick(); // 先渲染乱码初始态
  };

  play();
})();
