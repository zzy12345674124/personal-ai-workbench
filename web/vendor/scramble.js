// web/vendor/scramble.js —— 乱码文字效果（悬停/加载动效，GSAP 时间线驱动）
const GLYPHS = '!<>-_\\/[]{}—=+*^?#________';

let tl = null;          // 当前动画时间线（闭包持有：重入时 kill 时间线本身，unscramble 用它终止动画）
let originalText = '';  // 最近一次 scrambleText 的原文（unscramble 还原用）

function randomizeText(text, rng) {
  return text
    .split('')
    .map((ch) => (ch === ' ' ? ' ' : GLYPHS[Math.floor(rng() * GLYPHS.length)]))
    .join('');
}

window.scrambleText = (el, text, { duration = 0.8, charClass = 'scramble' } = {}) => {
  // 防重入：时间线 tween 的是 props 对象数组而非 el，killTweensOf(el) 杀不到，须 kill 时间线本身
  if (tl) tl.kill();
  originalText = text;
  let seed = 1;
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const targets = text.split('');
  const props = targets.map(() => ({ revealed: 0 }));
  // 每帧把 revealed 进度写回 el.textContent（由时间线 onUpdate 驱动）
  const tick = () => {
    el.textContent = targets.map((ch, i) => (props[i].revealed >= 1 ? ch : randomizeText(ch, rng))).join('');
  };
  if (!window.gsap) { el.textContent = text; return; }  // 无 GSAP 降级：直接显示原文，不设乱码
  tick();  // 先渲染乱码初始态（props 全为 revealed: 0），再逐字符还原
  tl = gsap.timeline({ onUpdate: tick });  // onUpdate：动画期间每帧把 revealed 进度写回 DOM，否则结束后永久乱码
  targets.forEach((_, i) => {
    tl.to(props[i], { revealed: 1, duration: duration / targets.length, ease: 'power2.out' }, i * (duration / targets.length) * 0.6);
  });
  tl.add(() => el.classList.add(charClass));
  return tl;
};

window.unscramble = (el) => {
  if (window.gsap && tl) tl.kill();  // 终止进行中的动画（若有）
  el.textContent = originalText;     // 直接用闭包里的原文还原，免去逐字再算
};
