// The nav is see-through, so its text goes light over the navy hero and dark everywhere else.
(() => {
  const nav = document.querySelector(".nav");
  const dark = [...document.querySelectorAll('[data-nav="dark"]')];
  const update = () => {
    const y = nav.getBoundingClientRect().bottom - 1;
    const overDark = dark.some((el) => {
      const r = el.getBoundingClientRect();
      return r.top <= y && r.bottom > y;
    });
    nav.classList.toggle("on-light", !overDark);
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
})();

// The logo is a splat, so the closing section lets you throw some. Each one
// lands where you click, a bit rotated and sized at random, then fades.
(() => {
  const area = document.querySelector("[data-splat]");
  if (!area || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  area.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a")) return;
    const r = area.getBoundingClientRect();
    const img = new Image();
    img.src = "/brand/stash-splat-192.png";
    img.alt = "";
    img.className = "thrown";
    img.style.left = `${e.clientX - r.left}px`;
    img.style.top = `${e.clientY - r.top}px`;
    img.style.rotate = `${Math.round(Math.random() * 360)}deg`;
    img.style.setProperty("--s", (0.6 + Math.random() * 0.9).toFixed(2));
    area.appendChild(img);
    setTimeout(() => img.remove(), 6400);
  });
})();
