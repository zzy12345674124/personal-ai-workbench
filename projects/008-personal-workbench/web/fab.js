// web/fab.js —— FAB 放射快捷操作（radial-menu 改造：动作由当前面板注册）
// 注意：gsap 由 index.html 的经典 <script> 加载（window.gsap 全局可用）。
// 不得 `import './vendor/gsap.min.js'`——UMD 经典脚本在 ESM 模块上下文会抛
// "Cannot set property window of #<Window>"（3.15 实测，2026-08-06），拖垮整个模块图。

export function mountFab(host) {
  host.innerHTML = `
    <div class="fab-wrap">
      ${[1, 2, 3].map((i) => `<button class="fab-item" data-i="${i}" type="button"></button>`).join('')}
      <button class="fab" id="fabMain" aria-expanded="false" aria-label="快捷操作">＋</button>
    </div>`;
  const items = [...host.querySelectorAll('.fab-item')];
  const main = host.querySelector('#fabMain');
  const radius = 96;
  // 右下角锚点：180°-270° 向左上扇形展开（与素材 radial-menu 一致，三项不溢出视口）
  const startAngle = 180, endAngle = 270;
  let actions = [];
  let open = false;

  const render = () => {
    items.forEach((b, i) => {
      if (actions[i]) { b.textContent = actions[i].label; b.title = actions[i].label; b.hidden = false; }
      else b.hidden = true;
    });
  };

  const toggle = () => {
    open = !open;
    main.setAttribute('aria-expanded', String(open));
    items.forEach((b, i) => {
      if (!actions[i]) return;
      // xPercent/yPercent:-50 让每个按钮的中心点落在扇形位点上（修复：CSS translateX(-50%)
      // 会被 GSAP x/y 补间接管丢弃，导致各按钮按自身半宽偏移、排版错位——2026-08-06 验收）
      if (open) {
        const angle = (startAngle + ((endAngle - startAngle) / (actions.length - 1 || 1)) * i) * (Math.PI / 180);
        gsap.to(b, { xPercent: -50, yPercent: -50, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, scale: 1, opacity: 1, duration: 0.5, ease: 'elastic.out(1,0.5)' });
      } else {
        gsap.to(b, { xPercent: -50, yPercent: -50, x: 0, y: 0, scale: 0, opacity: 0, duration: 0.3, ease: 'power2.in' });
      }
    });
  };
  main.addEventListener('click', toggle);

  // 审查修复（Critical #1）：FAB 项点击 → 收起菜单 + 执行面板注册的动作；
  // 此前只渲染标签和动画，没有任何监听调用 actions[i].cb()，点击无响应
  items.forEach((b, i) => b.addEventListener('click', () => {
    if (!actions[i]) return;
    toggle();
    actions[i].cb();
  }));

  return {
    setActions(list) {
      if (open) toggle();
      actions = list.slice(0, items.length);
      main.hidden = actions.length === 0;
      render();
    },
  };
}
