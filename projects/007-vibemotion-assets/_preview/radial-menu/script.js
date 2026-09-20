const items = gsap.utils.toArray(".fab-item");
const radius = 120;
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
    tl.timeScale(speed).reverse();
    document.querySelector("#fabBtn").setAttribute("aria-expanded", "false");
  } else {
    const erVal = getEaseReverse();
    tl.timeScale(1).play();
    document.querySelector("#fabBtn").setAttribute("aria-expanded", "true");
  }
  isOpen = !isOpen;
}

document.querySelector("#fabBtn").addEventListener("click", toggle);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isOpen) toggle();
});
