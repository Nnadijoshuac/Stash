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
