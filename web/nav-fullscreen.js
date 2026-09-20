// web/nav-fullscreen.js —— 浮岛全屏导航（menu-navigation-pattern 改造：菜单项来自 tools.json）
// 注意：gsap 由 index.html 的经典 <script> 加载（window.gsap 全局可用）。
// 不得 `import './vendor/gsap.min.js'`——UMD 经典脚本在 ESM 模块上下文会抛
// "Cannot set property window of #<Window>"（3.15 实测，2026-08-06），拖垮整个模块图。
import { esc } from './utils.js';

export function mountNavFullscreen(container, { actions, onSelect }) {
  container.innerHTML = `
    <div class="island-wrap">
      <button class="island" id="navIsland" aria-expanded="false">
        <span class="island-dot" aria-hidden="true"></span>
        <span class="island-label">浏览工具</span>
      </button>
    </div>
    <div class="nav-overlay" id="navOverlay" role="dialog" aria-modal="true" aria-label="工具导航" aria-hidden="true">
      <div class="nav-backdrop"></div>
      <div class="nav-panel">
        <div class="nav-kicker">个人工作台</div>
        ${actions.map((a, i) => `<a class="nav-link" data-id="${esc(a.id)}" role="button" tabindex="-1"><span><span class="nav-link-icon">${esc(a.icon)}</span>${esc(a.name)}</span><span class="link-num">${String(i + 1).padStart(2, '0')}</span></a>`).join('')}
      </div>
    </div>`;
  const overlay = container.querySelector('#navOverlay');
  const island = container.querySelector('#navIsland');
  const links = [...overlay.querySelectorAll('.nav-link')];
  let open = false;
  let tl;

  const build = () => {
    if (tl) tl.kill();
    tl = gsap.timeline({ paused: true })
      .set(overlay, { pointerEvents: 'auto', visibility: 'visible' })
      // 只动画合成层属性（opacity/transform）。旧版 width 动画会逐帧触发布局，
      // 全屏 blur 又会重采样整个页面，两者叠加导致打开菜单掉帧。
      .to(island, { scale: 1.035, duration: 0.18, ease: 'power2.out', force3D: true }, 0)
      .to(overlay, { opacity: 1, duration: 0.2, ease: 'power1.out' }, 0)
      .from(container.querySelector('.nav-panel'), { autoAlpha: 0, y: -14, duration: 0.28, ease: 'power2.out', force3D: true }, 0.04)
      .from(container.querySelectorAll('.nav-link'), { opacity: 0, y: 6, duration: 0.18, ease: 'power1.out', force3D: true, stagger: 0.025 }, 0.08);
  };
  build();

  const toggle = () => {
    open = !open;
    island.setAttribute('aria-expanded', String(open));
    overlay.setAttribute('aria-hidden', String(!open));
    links.forEach((l) => l.setAttribute('tabindex', open ? '0' : '-1'));
    if (open) {
      tl.eventCallback('onComplete', () => links[0]?.focus());
      tl.timeScale(1).play();
    }
    else {
      // 关闭：遮罩淡出动画完成后才恢复 pointer-events:none，避免动画播放中点击穿透（bug 修复：此前 reverse 后 set(pointerEvents:'auto') 残留，全屏层拦截所有点击）
      tl.eventCallback('onReverseComplete', () => {
        gsap.set(overlay, { pointerEvents: 'none', visibility: 'hidden' });
        island.focus();
      });
      tl.timeScale(1.8).reverse();
    }
  };
  island.addEventListener('click', toggle);
  overlay.addEventListener('click', (e) => { if (open && e.target.classList.contains('nav-backdrop')) toggle(); });
  links.forEach((l) => l.addEventListener('click', () => { toggle(); onSelect(l.dataset.id); }));
  links.forEach((l) => l.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); l.click(); }
  }));
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { toggle(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [island, ...links];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return { toggle };
}
