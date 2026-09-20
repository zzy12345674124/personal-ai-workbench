let isOpen = false;
let exitSpeed = 1;
const toggleEl = document.querySelector('#easeReverse');
const exitSlider = document.querySelector('#exitSpeed');
const exitLabel = document.querySelector('#exitSpeedVal');
const island = document.querySelector('.island');
const expandedWidth = Math.min(window.innerWidth * 0.9, 400);
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
    tl.timeScale(1).play();
  } else {
    tl.eventCallback('onReverseComplete', () => gsap.set('.menu-overlay', { pointerEvents: 'none' }));
    tl.timeScale(exitSpeed).reverse();
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