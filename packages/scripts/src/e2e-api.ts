/**
 * Runs the whole flow through the app's API, acting as the browser.
 * Start the app first (pnpm --filter @stash/web dev), then run `pnpm api`.
 *
 * A new wallet is made here and its key never reaches the server. It gets
 * funded, sets a rule, gets paid, stashes, then sells, signing each step
 * locally. It also tries four cheats and expects each one refused: a different
 * transaction under the same build, the same build twice, stashing a payment
 * that was already stashed, and sending that second stash straight to the
 * chain, where the program refuses it.
 */
import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { allocate, buildBasket } from "@stash/core";
import { SURFNET_RPC_URL, loadOrCreateKeypair } from "@stash/fork";

const API = process.env.STASH_API ?? "http://localhost:4321";
const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDA = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

const wallet = Keypair.generate();
const owner = wallet.publicKey.toBase58();
let failures = 0;

async function call(path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API}${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
async function ok(path: string, body?: unknown): Promise<any> {
  const r = await call(path, body);
  if (r.status !== 200) throw new Error(`${path} -> ${r.status} ${r.data.error}`);
  return r.data;
}
async function refused(label: string, path: string, body: unknown, pattern: RegExp): Promise<void> {
  const r = await call(path, body);
  const pass = r.status !== 200 && pattern.test(String(r.data.error));
  if (!pass) failures++;
  console.log(`  ${pass ? "refused" : "NOT REFUSED"}: ${label} -> ${r.data.error ?? r.status}`);
}
function sign(base64: string): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  tx.sign([wallet]);
  return Buffer.from(tx.serialize()).toString("base64");
}

console.log(`Client wallet (key never leaves this process): ${owner}`);
await ok("/api/dev/fund", { owner });
await ok("/api/eligibility", { owner, confirm: true });
// The rule lives on chain, so it's a transaction this wallet signs.
const ruleBuild = await ok("/api/rule/build", { owner, stashBps: 2000, basket: [{ mint: SPY, weightBps: 6000 }, { mint: NVDA, weightBps: 4000 }] });
const ruleTx = await ok("/api/submit", { buildId: ruleBuild.buildId, signedTransaction: sign(ruleBuild.transaction) });
console.log(`Rule saved on chain: ${ruleTx.signature.slice(0, 16)}…`);

const paid = await ok("/api/receive", { owner, usdc: "500000000" });
console.log(`Paid $500: ${paid.signature.slice(0, 16)}…`);
const payments = await ok(`/api/payments?owner=${owner}`);
const payment = payments.find((p: any) => p.signature === paid.signature);
if (!payment) throw new Error("The payment was not detected.");
console.log(`Detected on chain: $${Number(payment.amountUsdc) / 1e6}`);

// Stash: build, sign here, submit. Rebuild once if prices moved.
let stash: any;
for (let attempt = 1; attempt <= 2 && !stash; attempt++) {
  const build = await ok("/api/stash/build", { owner, paymentSignature: payment.signature });
  if (attempt === 1) {
    // Cheat 1: sign a different transaction and submit it under this build.
    const fake = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: VersionedTransaction.deserialize(Buffer.from(build.transaction, "base64")).message.recentBlockhash,
        instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
      }).compileToV0Message(),
    );
    fake.sign([wallet]);
    await refused("a different transaction under the same build", "/api/submit",
      { buildId: build.buildId, signedTransaction: Buffer.from(fake.serialize()).toString("base64") }, /not the one Stash built/);
  }
  const r = await call("/api/submit", { buildId: build.buildId, signedTransaction: sign(build.transaction) });
  if (r.status === 200) stash = r.data;
  else if (r.data.retry) console.log(`  attempt ${attempt}: ${r.data.error}`);
  else throw new Error(r.data.error);
  if (stash) {
    // Cheat 2: replay the same build.
    await refused("submitting the same build twice", "/api/submit",
      { buildId: build.buildId, signedTransaction: sign(build.transaction) }, /expired|Build it again/);
  }
}
if (!stash) throw new Error("Stash did not land in two attempts.");
console.log(`Stashed $${Number(stash.stashUsdc) / 1e6} of $500 (spent $${Number(stash.spentUsdc) / 1e6}), signed by the client: ${stash.signature.slice(0, 16)}…`);

// Cheat 3: stash the same payment again.
await refused("stashing an already-stashed payment", "/api/stash/build", { owner, paymentSignature: payment.signature }, /already stashed/);

// Cheat 4: skip the server and send a second stash of the same payment
// straight to the chain. The program's receipt for this payment already
// exists, so Solana itself has to refuse it.
{
  const connection = new Connection(SURFNET_RPC_URL, "confirmed");
  const allocation = allocate(BigInt(payment.amountUsdc), { stashBps: 2000, basket: [{ mint: SPY, weightBps: 6000 }, { mint: NVDA, weightBps: 4000 }] });
  const treasury = loadOrCreateKeypair("treasury").publicKey.toBase58();
  const built = await buildBasket({ connection, owner, treasury, allocation, paymentSignature: payment.signature });
  built.transaction.sign([wallet]);
  const sim = await connection.simulateTransaction(built.transaction, { sigVerify: true });
  const pass = sim.value.err !== null;
  if (!pass) failures++;
  console.log(`  ${pass ? "refused on chain" : "NOT REFUSED"}: a second stash of the same payment sent directly to Solana -> ${JSON.stringify(sim.value.err)}`);
}

// Sell half the Nvidia we just bought.
let sale: any;
for (let attempt = 1; attempt <= 2 && !sale; attempt++) {
  const build = await ok("/api/sell/build", { owner, mint: NVDA, percent: 50 });
  const r = await call("/api/submit", { buildId: build.buildId, signedTransaction: sign(build.transaction) });
  if (r.status === 200) sale = r.data;
  else if (r.data.retry) console.log(`  sell attempt ${attempt}: ${r.data.error}`);
  else throw new Error(r.data.error);
}
if (!sale) throw new Error("Sale did not land in two attempts.");
console.log(`Sold half the NVDAx for $${(Number(sale.receivedUsdc) / 1e6).toFixed(2)}, signed by the client: ${sale.signature.slice(0, 16)}…`);

const state = await ok(`/api/state?owner=${owner}`);
console.log(`State for this wallet: ${state.stashes.length} stash, ${state.sells.length} sale, USDC $${(Number(state.usdc) / 1e6).toFixed(2)}`);
if (failures) {
  console.log(`\n${failures} cheat(s) were NOT refused.`);
  process.exit(1);
}
console.log("\nAll cheats refused. The server never held this wallet's key.");
