// Barebones client. All money logic lives on the server in @stash/core; this
// file only sends what the user typed and shows what came back.

const $ = (id) => document.getElementById(id);
let state = null;
let previewed = null; // signature of the payment last previewed

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
  // form further down happens out of sight and looks like nothing happened
  // (found by the GUI test, ISSUES #8).
  if (message) $("error").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

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
  $("network").textContent = `${state.network}. Wallet ${state.wallet}`;
  $("eligibility").hidden = Boolean(state.eligibleConfirmedAt);

  const rows = [`<tr><td>USDC</td><td>US dollar</td><td class="num">${usd(state.usdc)}</td></tr>`]
    .concat(state.holdings.map((h) =>
      `<tr><td>${h.symbol}</td><td>${h.tracks}</td><td class="num">${shares(h.amount, h.decimals)} shares</td></tr>`));
  $("balances").innerHTML = rows.join("");

  if (state.rule) {
    const parts = state.rule.basket.map((b) => {
      const s = state.stocks.find((x) => x.mint === b.mint);
      return `${b.weightBps / 100}% ${s ? s.tracks : b.mint}`;
    });
    $("rule-summary").textContent = `Stash ${state.rule.stashBps / 100}% of every payment: ${parts.join(", ")}.`;
    $("stash-pct").value = state.rule.stashBps / 100;
  }
  renderBasketRows(state.rule);

  $("history").innerHTML = state.stashes.length
    ? state.stashes.map((s) =>
        `<li>${new Date(s.at).toLocaleString()}: stashed ${usd(s.stashUsdc)} of ${usd(s.paymentUsdc)} ` +
        `(${s.legs.map((l) => `${usd(l.usdc)} ${l.symbol}`).join(", ")}). ` +
        `${s.bytes} bytes, ${s.computeUnits} CU.<br><code>${s.signature}</code></li>`).join("")
    : "<li>No stashes yet.</li>";
}

async function refresh() {
  const [s, payments] = await Promise.all([api("/api/state"), api("/api/payments")]);
  state = s;
  render();
  renderPayments(payments);
}

$("eligible-btn").onclick = async () => {
  try {
    showError("");
    await api("/api/eligibility", { confirm: $("eligible-check").checked });
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
    await api("/api/rule", { stashBps: Math.round(Number($("stash-pct").value) * 100), basket });
    await refresh();
  } catch (e) { showError(e.message); }
};

$("receive-form").onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    showError("");
    const amount = toBaseUnits($("receive-amount").value);
    await api("/api/receive", { usdc: amount });
    await refresh();
  } catch (e) { showError(e.message); }
};

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

async function previewPayment(signature) {
  $("stash-btn").hidden = true;
  $("result").innerHTML = "";
  $("preview").textContent = "Getting live quotes…";
  try {
    showError("");
    const p = await api("/api/preview", { paymentSignature: signature });
    previewed = signature;
    $("preview").innerHTML =
      `<p>Stash ${usd(p.stashUsdc)} of this ${usd(p.paymentUsdc)} payment, in one transaction ` +
      `(${p.bytes} / 1232 bytes, ${p.accounts} / 64 accounts).</p>` +
      `<table><thead><tr><th>Stock</th><th class="num">Spend</th><th class="num">About</th><th>Route</th></tr></thead><tbody>` +
      p.legs.map((l) =>
        `<tr><td>${l.tracks} (${l.symbol})</td><td class="num">${usd(l.usdc)}</td>` +
        `<td class="num">${l.expectedShares.toFixed(6)} shares</td><td>${l.route}</td></tr>`).join("") +
      `</tbody></table><p class="note">Includes Stash's ${p.legs[0].feeBps / 100}% fee. Quotes move; the stash re-quotes when you press it.</p>` +
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
      await api("/api/skip", { paymentSignature: skip });
      if (previewed === skip) { $("preview").innerHTML = ""; $("stash-btn").hidden = true; }
      await refresh();
    } catch (e) { showError(e.message); }
  }
};

$("stash-btn").onclick = async () => {
  $("stash-btn").disabled = true;
  $("result").textContent = "Stashing…";
  try {
    showError("");
    const r = await api("/api/stash", { paymentSignature: previewed });
    $("result").innerHTML =
      `<p class="ok">Stashed ${usd(r.spentUsdc)} into ${r.legs.map((l) => l.symbol).join(", ")} ` +
      `in one transaction (${r.computeUnits} compute units).<br>Signature (fork): <code>${r.signature}</code></p>`;
    $("stash-btn").hidden = true;
    // Re-reading every payment from the chain takes a few seconds. Mark this
    // one stashed straight away so the row never looks untouched meanwhile.
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

refresh().catch((e) => showError(e.message));
