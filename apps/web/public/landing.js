// The nav is transparent, so its text colour follows what is under it:
// light text over the navy hero, dark text over the milk sections and the fade.
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
