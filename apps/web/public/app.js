// Stash client. All money logic lives on the server in @stash/core; this file
// holds the wallet, signs what the server builds, and renders.
//
// NON-CUSTODIAL: the server builds unsigned transactions; this page signs
// them with the user's wallet and sends them back. On the local fork the
// wallet is a keypair generated in this browser and kept in localStorage
// (fake money only). On mainnet the same `wallet` object would wrap Phantom.

const $ = (id) => document.getElementById(id);
const { Keypair, VersionedTransaction } = window.solanaWeb3;
let state = null;
let payments = [];
let editingRule = false;

/* ---------------------------------------------------------------- wallet */

const WALLET_KEY = "stash-fork-test-wallet";
const wallet = (() => {
  const saved = localStorage.getItem(WALLET_KEY);
  const kp = saved ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))) : Keypair.generate();
  const isNew = !saved;
  if (isNew) localStorage.setItem(WALLET_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return {
    isNew,
    publicKey: kp.publicKey.toBase58(),
    /** Signs a base64 unsigned transaction from the server; returns base64. */
    signTransaction(base64) {
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      tx.sign([kp]);
      return btoa(String.fromCharCode(...tx.serialize()));
    },
  };
})();
const owner = wallet.publicKey;

/* --------------------------------------------------------------- helpers */

const BASKET_COLOURS = ["#ff5a1f", "oklch(21% 0.035 262)", "oklch(72% 0.08 255)"];
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** "$12.50" -> "12500000" (USDC base units), using string maths, never floats. */
function toBaseUnits(dollars) {
  const s = String(dollars).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(s)) throw new Error("Enter a dollar amount like 500 or 12.50.");
  const [whole, frac = ""] = s.split(".");
  return (BigInt(whole) * 1000000n + BigInt(frac.padEnd(6, "0"))).toString();
}
/** Base units -> "$1,234.56". */
function usd(base) {
  const b = BigInt(base);
  const whole = (b / 1000000n).toLocaleString("en-US");
  return `$${whole}.${((b % 1000000n) / 10000n).toString().padStart(2, "0")}`;
}
const dollars = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokens = (amount, decimals) => (Number(amount) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });
const timeOf = (unix) => new Date(unix * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let errorTimer;
function showError(message) {
  clearTimeout(errorTimer);
  $("error").textContent = message;
  $("error").hidden = !message;
  if (message) errorTimer = setTimeout(() => ($("error").hidden = true), 7000);
}

async function call(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
async function api(path, body) {
  const { status, data } = await call(path, body);
  if (status !== 200) throw new Error(data.error || String(status));
  return data;
}

/**
 * Build on the server, sign here, submit. `onStep` reports real progress
 * (building, signing, sending). On a retryable refusal (prices moved, build
 * expired) it builds and signs once more.
 */
async function buildSignSubmit(buildPath, body, onStep = () => {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    onStep("build");
    const build = await api(buildPath, { owner, ...body });
    onStep("sign");
    const signedTransaction = wallet.signTransaction(build.transaction);
    onStep("send");
    const { status, data } = await call("/api/submit", { buildId: build.buildId, signedTransaction });
    if (status === 200) return data;
    if (!(data.retry && attempt === 1)) throw new Error(data.error || String(status));
  }
}

/* ---------------------------------------------------------------- render */

function render() {
  $("wallet-chip").textContent = `${short(owner)} · ${(state.sol / 1e9).toFixed(2)} SOL`;
  const eligible = Boolean(state.eligibleConfirmedAt);
  $("onboard").hidden = eligible;
  $("app").hidden = !eligible;
  if (!eligible) return;

  // Hero: the biggest number is what has been stashed.
  $("stashed-total").textContent = dollars(state.stashedUsd || 0);
  const stashedCount = state.stashes.length;
  $("hero-sub").textContent =
    `${usd(state.usdc)} USDC ready · ${stashedCount} ${stashedCount === 1 ? "stash" : "stashes"}`;
  const held = state.holdings.filter((h) => BigInt(h.amount) > 0n);
  $("holdings").innerHTML = held.length
    ? held.map((h) => {
        const chg = h.change24h == null ? "" :
          `<span class="chg ${h.change24h >= 0 ? "up" : "down"}">${h.change24h >= 0 ? "+" : ""}${h.change24h.toFixed(2)}% today</span>`;
        return `<li class="holding">
          <span class="ticker">${esc(h.symbol.replace(/x$/, ""))}</span>
          <span><span class="name">${esc(h.tracks)}</span><span class="sub">${tokens(h.amount, h.decimals)} ${esc(h.symbol)}</span></span>
          <span class="value">${h.usdValue == null ? "–" : dollars(h.usdValue)}${chg}</span>
          <button class="btn btn-sell" data-sell="${h.mint}">Sell</button>
        </li>`;
      }).join("")
    : `<li class="empty-ink">Nothing stashed yet. Your first payment will land here.</li>`;

  renderRule();
  renderActivity();
}

function renderRule() {
  const rule = state.rule;
  $("rule-edit-btn").textContent = rule ? "Edit" : "Set up";
  if (!rule) {
    $("rule-view").innerHTML = `<p class="empty">Choose how much of each payment to keep, and in which stocks.</p>`;
  } else {
    const parts = rule.basket.map((b, i) => {
      const s = state.stocks.find((x) => x.mint === b.mint);
      return { name: s ? s.tracks : short(b.mint), pct: b.weightBps / 100, colour: BASKET_COLOURS[i] };
    });
    $("rule-view").innerHTML =
      `<p class="rule-big">${rule.stashBps / 100}%</p>
       <p class="rule-of">of every payment, into</p>
       <div class="basket-bar">${parts.map((p) => `<span style="flex:${p.pct};background:${p.colour}"></span>`).join("")}</div>
       <ul class="basket-legend">${parts.map((p) =>
         `<li><span><span class="dot" style="background:${p.colour}"></span>${esc(p.name)}</span><strong>${p.pct}%</strong></li>`).join("")}</ul>`;
  }
  $("rule-view").hidden = editingRule;
  $("rule-form").hidden = !editingRule;
  $("rule-edit-btn").hidden = editingRule;
}

function renderRuleForm() {
  const rule = state.rule;
  $("stash-pct").value = rule ? rule.stashBps / 100 : 20;
  $("stash-pct-out").textContent = `${$("stash-pct").value}%`;
  const current = rule ? rule.basket : [{ mint: state.stocks[0].mint, weightBps: 10000 }];
  $("basket-rows").innerHTML = [0, 1, 2].map((i) => {
    const pick = current[i];
    const options = ['<option value="">No stock</option>']
      .concat(state.stocks.map((s) => `<option value="${s.mint}" ${pick && pick.mint === s.mint ? "selected" : ""}>${esc(s.tracks)} · ${esc(s.symbol)}</option>`))
      .join("");
    return `<div class="basket-row">
      <select data-i="${i}" aria-label="Stock ${i + 1}">${options}</select>
      <span class="pct-input"><input type="number" data-w="${i}" min="0" max="100" step="1" value="${pick ? pick.weightBps / 100 : 0}" aria-label="Share for stock ${i + 1}">%</span>
    </div>`;
  }).join("");
}

function renderPayments() {
  const pending = payments.filter((p) => !p.decision);
  $("pending-count").textContent = pending.length ? `${pending.length} to stash` : "";
  if (!payments.length) {
    $("payments").innerHTML = `<li class="empty">When someone pays you in USDC, it shows up here, ready to stash.</li>`;
    return;
  }
  const pct = state.rule ? state.rule.stashBps : null;
  $("payments").innerHTML = payments.slice(0, 8).map((p) => {
    const when = p.blockTime ? timeOf(p.blockTime) : "";
    const from = p.from ? `from ${short(p.from)}` : "";
    if (p.decision) {
      return `<li class="payment done">
        <div><div class="amount">${usd(p.amountUsdc)}</div><div class="meta">${from} · ${when}</div></div>
        <span class="tag ${p.decision.status}">${p.decision.status === "stashed" ? "Stashed" : "Left in USDC"}</span>
      </li>`;
    }
    const stashAmt = pct ? usd((BigInt(p.amountUsdc) * BigInt(pct)) / 10000n) : null;
    return `<li class="payment">
      <div><div class="amount">${usd(p.amountUsdc)}</div><div class="meta">${from} · ${when}</div></div>
      <div class="actions">
        <button class="btn btn-quiet btn-sm" data-skip="${p.signature}">Skip</button>
        <button class="btn btn-primary btn-sm" data-stash="${p.signature}" ${pct ? "" : "disabled title=\"Set your rule first\""}>Stash ${stashAmt ?? ""}</button>
      </div>
    </li>`;
  }).join("");
}

function renderActivity() {
  const items = [
    ...state.stashes.map((s) => ({ at: s.at, kind: "stash", s })),
    ...state.sells.map((s) => ({ at: s.at, kind: "sell", s })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  $("activity").innerHTML = items.length
    ? items.slice(0, 12).map(({ kind, s }) => {
        const when = new Date(s.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        if (kind === "stash") {
          return `<li><span class="act-icon"><img src="/brand/stash-splat-32.png" alt=""></span>
            <span><span class="act-title">Stashed from a ${usd(s.paymentUsdc)} payment</span>
              <span class="act-sub">${s.legs.map((l) => `${usd(l.usdc)} ${esc(l.symbol)}`).join(" · ")} · ${when}</span></span>
            <span class="act-amt">${usd(s.stashUsdc)}</span></li>`;
        }
        return `<li><span class="act-icon sell">↩</span>
          <span><span class="act-title">Sold ${esc(s.symbol)} back to USDC</span><span class="act-sub">${when}</span></span>
          <span class="act-amt">+${usd(s.receivedUsdc)}</span></li>`;
      }).join("")
    : `<li class="empty">Your stashes and sales will appear here.</li>`;
}

async function refresh() {
  const [s, p] = await Promise.all([api(`/api/state?owner=${owner}`), api(`/api/payments?owner=${owner}`)]);
  state = s;
  payments = p;
  render();
  if (state.eligibleConfirmedAt) renderPayments();
}

/* ---------------------------------------------------------------- sheet */

function openSheet(html) {
  $("sheet-body").innerHTML = html;
  $("sheet").hidden = false;
}
function closeSheet() { $("sheet").hidden = true; $("sheet-body").innerHTML = ""; }
$("sheet-close").onclick = closeSheet;
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

function stepsHtml(labels, current) {
  const order = Object.keys(labels);
  const at = order.indexOf(current);
  return `<ul class="steps">${order.map((k, i) =>
    `<li class="${i < at ? "done" : i === at ? "now" : ""}">${labels[k]}</li>`).join("")}</ul>`;
}

/* ---------------------------------------------------------------- stash flow */

async function openStash(signature) {
  openSheet(`<p class="eyebrow-dark" id="sheet-title">Getting live quotes…</p><div class="sheet-big">&nbsp;</div>`);
  try {
    const p = await api("/api/preview", { owner, paymentSignature: signature });
    $("sheet-body").innerHTML = `
      <p class="eyebrow-dark" id="sheet-title">You'll stash</p>
      <div class="sheet-big">${usd(p.stashUsdc)}</div>
      <p class="sheet-sub">of your ${usd(p.paymentUsdc)} payment, into</p>
      <ul class="legs">${p.legs.map((l) => `<li>
        <span><span class="leg-name">${esc(l.tracks)}</span><span class="leg-route">${esc(l.symbol)} · via ${esc(l.route)}</span></span>
        <span class="leg-amt">${usd(l.usdc)}<span class="leg-shares">≈ ${l.expectedShares.toFixed(6)} ${esc(l.symbol)}</span></span>
      </li>`).join("")}</ul>
      <p class="proof">One Solana transaction (${p.bytes} of 1,232 bytes). Every stock lands, or nothing moves.
        Includes Stash's ${p.legs[0].feeBps / 100}% fee.</p>
      <button class="btn btn-primary btn-lg" id="confirm-stash">Sign &amp; stash ${usd(p.stashUsdc)}</button>`;
    $("confirm-stash").onclick = () => runStash(signature, p);
  } catch (e) {
    closeSheet();
    showError(e.message);
  }
}

async function runStash(signature, preview) {
  const labels = { build: "Building one transaction", sign: "Signing in your wallet", send: "Sending to Solana" };
  const step = (k) => {
    $("sheet-body").innerHTML = `<p class="eyebrow-dark" id="sheet-title">Stashing</p>
      <div class="sheet-big">${usd(preview.stashUsdc)}</div>${stepsHtml(labels, k)}`;
  };
  try {
    const r = await buildSignSubmit("/api/stash/build", { paymentSignature: signature }, step);
    // The peak moment: the splat lands (DESIGN.md).
    $("sheet-body").innerHTML = `<div class="success">
      <img class="splat-land" src="/brand/stash-splat-192.png" alt="">
      <p class="eyebrow-dark" id="sheet-title">Stashed</p>
      <div class="sheet-big">${usd(r.spentUsdc)}</div>
      <p class="sheet-sub">${r.legs.map((l) => `${usd(l.usdc)} ${esc(l.symbol)}`).join(" · ")}</p>
      <p class="sig">Signed by your wallet · ${r.computeUnits.toLocaleString()} compute units<br>Fork signature ${esc(r.signature)}</p>
      <button class="btn btn-dark btn-lg" id="done-btn">Done</button></div>`;
    $("done-btn").onclick = closeSheet;
    const p = payments.find((x) => x.signature === signature);
    if (p) p.decision = { status: "stashed" };
    renderPayments();
    refresh().catch(() => {});
  } catch (e) {
    closeSheet();
    showError(e.message);
  }
}

/* ---------------------------------------------------------------- sell flow */

function openSell(mint) {
  const h = state.holdings.find((x) => x.mint === mint);
  let percent = 50;
  const draw = (quote) => {
    $("sheet-body").innerHTML = `
      <p class="eyebrow-dark" id="sheet-title">Sell ${esc(h.tracks)}</p>
      <div class="sheet-big">${quote ? usd(quote.expectedUsdc) : "…"}</div>
      <p class="sheet-sub">${quote ? `for ${quote.sellShares.toFixed(6)} ${esc(h.symbol)} of your ${quote.holdingShares.toFixed(6)}` : "Getting a live quote"}</p>
      <div class="chips">${[25, 50, 100].map((v) =>
        `<button class="chip" data-pct="${v}" aria-pressed="${v === percent}">${v === 100 ? "All" : v + "%"}</button>`).join("")}</div>
      <p class="proof">Back to USDC in one transaction${quote ? `, via ${esc(quote.route)}` : ""}. Includes Stash's 0.5% fee.</p>
      <button class="btn btn-dark btn-lg" id="confirm-sell" ${quote ? "" : "disabled"}>Sign &amp; sell</button>`;
    document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => { percent = Number(c.dataset.pct); load(); }));
    if (quote) $("confirm-sell").onclick = () => runSell(mint, percent, h);
  };
  const load = async () => {
    draw(null);
    try { draw(await api("/api/sell/preview", { owner, mint, percent })); }
    catch (e) { closeSheet(); showError(e.message); }
  };
  openSheet("");
  load();
}

async function runSell(mint, percent, h) {
  const labels = { build: "Building the sale", sign: "Signing in your wallet", send: "Sending to Solana" };
  const step = (k) => {
    $("sheet-body").innerHTML = `<p class="eyebrow-dark" id="sheet-title">Selling ${esc(h.tracks)}</p>${stepsHtml(labels, k)}`;
  };
  try {
    const r = await buildSignSubmit("/api/sell/build", { mint, percent }, step);
    $("sheet-body").innerHTML = `<div class="success">
      <p class="eyebrow-dark" id="sheet-title">Sold ${esc(r.symbol)}</p>
      <div class="sheet-big">+${usd(r.receivedUsdc)}</div>
      <p class="sheet-sub">back in USDC</p>
      <p class="sig">Signed by your wallet<br>Fork signature ${esc(r.signature)}</p>
      <button class="btn btn-dark btn-lg" id="done-btn">Done</button></div>`;
    $("done-btn").onclick = closeSheet;
    refresh().catch(() => {});
  } catch (e) {
    closeSheet();
    showError(e.message);
  }
}

/* --------------------------------------------------------------- actions */

$("eligible-btn").onclick = async () => {
  try {
    if (!$("eligible-check").checked) throw new Error("Tick the box to confirm you are eligible to hold xStocks.");
    await api("/api/eligibility", { owner, confirm: true });
    await refresh();
    if (!state.rule) { editingRule = true; renderRuleForm(); renderRule(); }
  } catch (e) { showError(e.message); }
};

$("rule-edit-btn").onclick = () => { editingRule = true; renderRuleForm(); renderRule(); };
$("rule-cancel").onclick = () => { editingRule = false; renderRule(); };
$("stash-pct").oninput = () => { $("stash-pct-out").textContent = `${$("stash-pct").value}%`; };
$("rule-form").onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    const basket = [];
    for (let i = 0; i < 3; i++) {
      const mint = document.querySelector(`select[data-i="${i}"]`).value;
      const pct = Number(document.querySelector(`input[data-w="${i}"]`).value);
      if (mint) basket.push({ mint, weightBps: Math.round(pct * 100) });
    }
    await api("/api/rule", { owner, stashBps: Math.round(Number($("stash-pct").value) * 100), basket });
    editingRule = false;
    await refresh();
  } catch (e) { showError(e.message); }
};

$("receive-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const btn = $("receive-btn");
  btn.disabled = true;
  btn.textContent = "Receiving…"; // the payer's transfer takes a few seconds (ISSUES #14)
  try {
    await api("/api/receive", { owner, usdc: toBaseUnits($("receive-amount").value) });
    await refresh();
  } catch (e) { showError(e.message); }
  finally { btn.disabled = false; btn.textContent = "Receive"; }
};

$("payments").onclick = async (ev) => {
  const t = ev.target.closest("button");
  if (!t) return;
  if (t.dataset.stash) return openStash(t.dataset.stash);
  if (t.dataset.skip) {
    try {
      await api("/api/skip", { owner, paymentSignature: t.dataset.skip });
      const p = payments.find((x) => x.signature === t.dataset.skip);
      if (p) p.decision = { status: "skipped" };
      renderPayments();
    } catch (e) { showError(e.message); }
  }
};

$("holdings").onclick = (ev) => {
  const t = ev.target.closest("button[data-sell]");
  if (t) openSell(t.dataset.sell);
};

/* ------------------------------------------------------------------ start */

(async () => {
  try {
    if (wallet.isNew) await api("/api/dev/fund", { owner });
    await refresh();
  } catch (e) { showError(e.message); }
})();
