// Barebones client. All money logic lives on the server in @stash/core; this
// file holds the wallet, signs what the server builds, and shows results.
//
// NON-CUSTODIAL: the server builds unsigned transactions; this page signs
// them with the user's wallet and sends them back. The server never sees the
// key. On the local fork the wallet is a keypair generated in this browser
// and kept in localStorage (fake money only). On mainnet the same `wallet`
// object would wrap Phantom's signTransaction instead.

const $ = (id) => document.getElementById(id);
const { Keypair, VersionedTransaction } = window.solanaWeb3;
let state = null;
let previewed = null; // signature of the payment last previewed

/* ---------------------------------------------------------------- wallet */

const WALLET_KEY = "stash-fork-test-wallet";

/** The fork test wallet: created once in this browser, never sent anywhere. */
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

/** "$12.50" -> "12500000" (USDC base units), using string maths, never floats. */
function toBaseUnits(dollars) {
  const s = String(dollars).trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{0,6})?$/.test(s)) throw new Error("Enter a dollar amount like 500 or 12.50.");
  const [whole, frac = ""] = s.split(".");
  return (BigInt(whole) * 1000000n + BigInt(frac.padEnd(6, "0"))).toString();
}
function usd(base) {
  const b = BigInt(base);
  return `$${b / 1000000n}.${((b % 1000000n) / 10000n).toString().padStart(2, "0")}`;
}
const shares = (amount, decimals) => (Number(amount) / 10 ** decimals).toFixed(6);

function showError(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
  // The error box sits at the top of the page. Without this, a refusal from a
  // form further down happens out of sight (ISSUES #8).
  if (message) $("error").scrollIntoView({ behavior: "smooth", block: "center" });
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
 * Build on the server, sign here, submit. If the network would reject it
 * (prices moved) or the build expired, build and sign once more.
 */
async function buildSignSubmit(buildPath, body) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const build = await api(buildPath, { owner, ...body });
    const signedTransaction = wallet.signTransaction(build.transaction);
    const { status, data } = await call("/api/submit", { buildId: build.buildId, signedTransaction });
    if (status === 200) return data;
    if (!(data.retry && attempt === 1)) throw new Error(data.error || String(status));
  }
}

/* ---------------------------------------------------------------- render */

function renderBasketRows(rule) {
  const rows = $("basket-rows");
  rows.innerHTML = "";
  const current = rule ? rule.basket : [];
  for (let i = 0; i < 3; i++) {
    const pick = current[i];
    const options = ['<option value="">(none)</option>']
      .concat(state.stocks.map((s) =>
        `<option value="${s.mint}" ${pick && pick.mint === s.mint ? "selected" : ""}>${s.tracks} (${s.symbol})</option>`))
      .join("");
    const pct = pick ? pick.weightBps / 100 : (i === 0 && !rule ? 100 : 0);
    rows.insertAdjacentHTML("beforeend",
      `<div class="row">Stock ${i + 1}: <select data-i="${i}">${options}</select>
       <input type="number" data-w="${i}" min="0" max="100" step="1" value="${pct}"> %</div>`);
  }
}

function render() {
  $("network").textContent =
    `${state.network}. Fork test wallet ${owner} (its key stays in this browser), ` +
    `${(state.sol / 1e9).toFixed(3)} SOL for fees.`;
  $("eligibility").hidden = Boolean(state.eligibleConfirmedAt);

  const rows = [`<tr><td>USDC</td><td>US dollar</td><td class="num">${usd(state.usdc)}</td></tr>`]
    .concat(state.holdings.map((h) =>
      `<tr><td>${h.symbol}</td><td>${h.tracks}</td><td class="num">${shares(h.amount, h.decimals)} shares</td></tr>`));
  $("balances").innerHTML = rows.join("");

  const held = state.holdings.filter((h) => BigInt(h.amount) > 0n);
  $("sell-stock").innerHTML = held.length
    ? held.map((h) => `<option value="${h.mint}">${h.tracks} (${h.symbol})</option>`).join("")
    : '<option value="">(nothing to sell yet)</option>';

  if (state.rule) {
    const parts = state.rule.basket.map((b) => {
      const s = state.stocks.find((x) => x.mint === b.mint);
      return `${b.weightBps / 100}% ${s ? s.tracks : b.mint}`;
    });
    $("rule-summary").textContent = `Stash ${state.rule.stashBps / 100}% of every payment: ${parts.join(", ")}.`;
    $("stash-pct").value = state.rule.stashBps / 100;
  }
  renderBasketRows(state.rule);

  const stashes = state.stashes.map((s) =>
    `<li>${new Date(s.at).toLocaleString()}: stashed ${usd(s.stashUsdc)} of ${usd(s.paymentUsdc)} ` +
    `(${s.legs.map((l) => `${usd(l.usdc)} ${l.symbol}`).join(", ")}). ${s.bytes} bytes, ${s.computeUnits} CU.` +
    `<br><code>${s.signature}</code></li>`);
  const sells = state.sells.map((s) =>
    `<li>${new Date(s.at).toLocaleString()}: sold ${s.symbol} for ${usd(s.receivedUsdc)}.<br><code>${s.signature}</code></li>`);
  $("history").innerHTML = stashes.concat(sells).join("") || "<li>Nothing yet.</li>";
}

function renderPayments(payments) {
  if (!payments.length) {
    $("payments").innerHTML = '<tr><td colspan="4">No payments yet. Use "Receive" above.</td></tr>';
    return;
  }
  $("payments").innerHTML = payments.map((p) => {
    const when = p.blockTime ? new Date(p.blockTime * 1000).toLocaleString() : "";
    const from = p.from ? `${p.from.slice(0, 4)}…${p.from.slice(-4)}` : "?";
    const action = p.decision
      ? `<span class="note">${p.decision.status}</span>`
      : `<button data-preview="${p.signature}">Preview</button> <button data-skip="${p.signature}">Skip</button>`;
    return `<tr><td>${when}</td><td class="num">${usd(p.amountUsdc)}</td><td><code>${from}</code></td><td>${action}</td></tr>`;
  }).join("");
}

async function refresh() {
  const [s, payments] = await Promise.all([api(`/api/state?owner=${owner}`), api(`/api/payments?owner=${owner}`)]);
  state = s;
  render();
  renderPayments(payments);
}

/* --------------------------------------------------------------- actions */

$("eligible-btn").onclick = async () => {
  try {
    showError("");
    await api("/api/eligibility", { owner, confirm: $("eligible-check").checked });
    await refresh();
  } catch (e) { showError(e.message); }
};

$("rule-form").onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    showError("");
    const basket = [];
    for (let i = 0; i < 3; i++) {
      const mint = document.querySelector(`select[data-i="${i}"]`).value;
      const pct = Number(document.querySelector(`input[data-w="${i}"]`).value);
      if (mint) basket.push({ mint, weightBps: Math.round(pct * 100) });
    }
    await api("/api/rule", { owner, stashBps: Math.round(Number($("stash-pct").value) * 100), basket });
    await refresh();
  } catch (e) { showError(e.message); }
};

$("receive-form").onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    showError("");
    await api("/api/receive", { owner, usdc: toBaseUnits($("receive-amount").value) });
    await refresh();
  } catch (e) { showError(e.message); }
};

async function previewPayment(signature) {
  $("stash-btn").hidden = true;
  $("result").innerHTML = "";
  $("preview").textContent = "Getting live quotes…";
  try {
    showError("");
    const p = await api("/api/preview", { owner, paymentSignature: signature });
    previewed = signature;
    $("preview").innerHTML =
      `<p>Stash ${usd(p.stashUsdc)} of this ${usd(p.paymentUsdc)} payment, in one transaction ` +
      `(${p.bytes} / 1232 bytes, ${p.accounts} / 64 accounts).</p>` +
      `<table><thead><tr><th>Stock</th><th class="num">Spend</th><th class="num">About</th><th>Route</th></tr></thead><tbody>` +
      p.legs.map((l) =>
        `<tr><td>${l.tracks} (${l.symbol})</td><td class="num">${usd(l.usdc)}</td>` +
        `<td class="num">${l.expectedShares.toFixed(6)} shares</td><td>${l.route}</td></tr>`).join("") +
      `</tbody></table><p class="note">Includes Stash's ${p.legs[0].feeBps / 100}% fee. Your wallet signs when you press Stash now.</p>` +
      p.warnings.map((w) => `<p class="note">${w}</p>`).join("");
    $("stash-btn").hidden = false;
  } catch (e) {
    $("preview").textContent = "";
    showError(e.message);
  }
}

$("payments").onclick = async (ev) => {
  const preview = ev.target.getAttribute && ev.target.getAttribute("data-preview");
  const skip = ev.target.getAttribute && ev.target.getAttribute("data-skip");
  if (preview) return previewPayment(preview);
  if (skip) {
    try {
      showError("");
      await api("/api/skip", { owner, paymentSignature: skip });
      if (previewed === skip) { $("preview").innerHTML = ""; $("stash-btn").hidden = true; }
      await refresh();
    } catch (e) { showError(e.message); }
  }
};

$("stash-btn").onclick = async () => {
  $("stash-btn").disabled = true;
  $("result").textContent = "Building, signing in your wallet, sending…";
  try {
    showError("");
    const r = await buildSignSubmit("/api/stash/build", { paymentSignature: previewed });
    $("result").innerHTML =
      `<p class="ok">Stashed ${usd(r.spentUsdc)} into ${r.legs.map((l) => l.symbol).join(", ")} ` +
      `in one transaction, signed by your wallet (${r.computeUnits} compute units).<br>Signature (fork): <code>${r.signature}</code></p>`;
    $("stash-btn").hidden = true;
    // Re-reading every payment takes a few seconds; mark this one at once (ISSUES #13).
    const row = document.querySelector(`button[data-preview="${previewed}"]`);
    if (row) row.parentElement.innerHTML = '<span class="note">stashed</span>';
    await refresh();
  } catch (e) {
    $("result").textContent = "";
    showError(e.message);
  } finally {
    $("stash-btn").disabled = false;
  }
};

$("sell-form").onsubmit = async (ev) => {
  ev.preventDefault();
  $("sell-result").textContent = "Building, signing in your wallet, sending…";
  try {
    showError("");
    const mint = $("sell-stock").value;
    if (!mint) throw new Error("You do not hold any stock to sell yet.");
    const r = await buildSignSubmit("/api/sell/build", { mint, percent: Number($("sell-pct").value) });
    $("sell-result").innerHTML =
      `<p class="ok">Sold ${r.symbol} for ${usd(r.receivedUsdc)}, signed by your wallet.<br>Signature (fork): <code>${r.signature}</code></p>`;
    await refresh();
  } catch (e) {
    $("sell-result").textContent = "";
    showError(e.message);
  }
};

/* ------------------------------------------------------------------ start */

(async () => {
  try {
    // A new fork wallet needs fake SOL to pay network fees.
    if (wallet.isNew) await api("/api/dev/fund", { owner });
    await refresh();
  } catch (e) { showError(e.message); }
})();
