/**
 * Get paid, then stash that payment, on the fork.
 *
 *   pnpm fund && pnpm payment
 *
 * The test payer sends $500 of USDC. We find it by reading the chain, read it
 * again by signature, and stash 20% of exactly what arrived.
 */
import { Connection } from "@solana/web3.js";
import {
  allocate,
  buildBasket,
  formatUsdc,
  getIncomingPayment,
  listIncomingPayments,
  type StashRule,
} from "@stash/core";
import {
  SURFNET_RPC_URL,
  assertSurfnet,
  loadOrCreateKeypair,
  protectedAccounts,
  prepareForkForSend,
  sendUsdc,
} from "@stash/fork";

const RULE: StashRule = {
  stashBps: 2_000,
  basket: [
    { mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", weightBps: 6_000 },
    { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", weightBps: 4_000 },
  ],
};

await assertSurfnet();
const connection = new Connection(SURFNET_RPC_URL, "confirmed");
const wallet = loadOrCreateKeypair("wallet");
const payer = loadOrCreateKeypair("payer");
const treasury = loadOrCreateKeypair("treasury").publicKey.toBase58();
const owner = wallet.publicKey.toBase58();

// 1. Get paid.
const paidSig = await sendUsdc(connection, payer, owner, 500_000_000n);
console.log(`Payer sent $500.00: ${paidSig}`);

// 2. Find it on chain.
const payments = await listIncomingPayments(connection, owner, { limit: 10 });
console.log(`\nIncoming payments found on chain: ${payments.length}`);
payments.slice(0, 5).forEach((p) =>
  console.log(`  ${formatUsdc(p.amountUsdc).padStart(9)} from ${p.from ?? "?"}  ${p.signature.slice(0, 20)}…`),
);
const found = payments.find((p) => p.signature === paidSig);
if (!found) {
  console.log("\nFAILED: the payment just sent was not found among incoming payments.");
  process.exit(1);
}
if (found.amountUsdc !== 500_000_000n || found.from !== payer.publicKey.toBase58()) {
  console.log(`\nFAILED: read ${formatUsdc(found.amountUsdc)} from ${found.from}; expected $500.00 from the payer.`);
  process.exit(1);
}
console.log(`Matched the payment: ${formatUsdc(found.amountUsdc)} from the payer.`);

// 3. Stash exactly that payment, re-read by signature.
const payment = await getIncomingPayment(connection, owner, paidSig);
if (!payment) throw new Error("Payment vanished between listing and stashing.");
const allocation = allocate(payment.amountUsdc, RULE);
const built = await buildBasket({ connection, owner, treasury, allocation });
await prepareForkForSend(built.routeAccounts, protectedAccounts(owner, treasury));
built.transaction.sign([wallet]);
const sim = await connection.simulateTransaction(built.transaction, { sigVerify: true });
if (sim.value.err) {
  console.log(`\nSimulation FAILED: ${JSON.stringify(sim.value.err)}`);
  (sim.value.logs ?? []).slice(-15).forEach((l) => console.log(`  ${l}`));
  process.exit(1);
}
const stashSig = await connection.sendRawTransaction(built.transaction.serialize(), { skipPreflight: true });
const conf = await connection.confirmTransaction(stashSig, "confirmed");
if (conf.value.err) throw new Error(`Stash failed on chain: ${stashSig}`);
console.log(`\nStashed ${formatUsdc(allocation.stashUsdc)} of that payment in one transaction: ${stashSig}`);
console.log(`  ${allocation.legs.map((l) => `${formatUsdc(l.usdc)} ${l.symbol}`).join(", ")}; ${sim.value.unitsConsumed} CU`);

// The user signed the stash, so it mustn't show up as a payment.
const after = await listIncomingPayments(connection, owner, { limit: 10 });
if (after.some((p) => p.signature === stashSig)) {
  console.log("\nFAILED: the stash itself was counted as an incoming payment.");
  process.exit(1);
}
console.log("The stash itself is correctly not counted as a payment.");
