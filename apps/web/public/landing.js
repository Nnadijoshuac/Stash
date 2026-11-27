// The nav is transparent, so its text colour follows what is under it:
// light text over the navy hero and footer, dark text over the milk sections.
(() => {
  const nav = document.querySelector(".nav");
  const dark = [...document.querySelectorAll('[data-nav="dark"]')];
  const update = () => {
    const y = nav.getBoundingClientRect().bottom - 1;
    const overDark = dark.some((el) => {
      const r = el.getBoundingClientRect();
      // The footer only counts once its fade has reached navy.
      const top = el.classList.contains("footer") ? r.top + parseFloat(getComputedStyle(el).paddingTop) * 0.7 : r.top;
      return top <= y && r.bottom > y;
    });
    nav.classList.toggle("on-light", !overDark);
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
})();
