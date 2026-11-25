/**
 * A real, signed stash, end to end, on a local mainnet fork. No real money.
 *
 *   pnpm fund && pnpm stash [3]
 *
 * Allocates a $500 payment by the README's rule, builds the basket through
 * the real core logic (allowlist, allocation, Jupiter quotes with Stash's fee,
 * one packed transaction), simulates it to measure compute units, sends it,
 * and reads balances before and after. Prints the signature as evidence.
 *
 * Pass "3" to stash into three stocks instead of two.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  STOCKS,
  USDC_MINT,
  allocate,
  buildBasket,
  formatUsdc,
  stockForMint,
  treasuryFeeAccount,
  type StashRule,
} from "@stash/core";
import { SURFNET_RPC_URL, assertSurfnet } from "@stash/fork";
import { loadOrCreateKeypair } from "@stash/fork";

const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDA = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TSLA = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

const threeLegs = process.argv[2] === "3";
const rule: StashRule = threeLegs
  ? { stashBps: 2_000, basket: [{ mint: SPY, weightBps: 5_000 }, { mint: NVDA, weightBps: 3_000 }, { mint: TSLA, weightBps: 2_000 }] }
  : { stashBps: 2_000, basket: [{ mint: SPY, weightBps: 6_000 }, { mint: NVDA, weightBps: 4_000 }] };
const PAYMENT = 500_000_000n; // a $500 USDC payment

await assertSurfnet();
const connection = new Connection(SURFNET_RPC_URL, "confirmed");
const wallet = loadOrCreateKeypair("wallet");
const treasury = loadOrCreateKeypair("treasury").publicKey.toBase58();
const owner = wallet.publicKey.toBase58();

/** Sum of an owner's balance in one mint, in base units. */
async function balance(holder: string, mint: string): Promise<bigint> {
  const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(holder), { mint: new PublicKey(mint) });
  return res.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount as string), 0n);
}
async function tokenAccountBalance(account: string): Promise<bigint> {
  const r = await connection.getTokenAccountBalance(new PublicKey(account)).catch(() => null);
  return r ? BigInt(r.value.amount) : 0n;
}
const shares = (amount: bigint, mint: string) => (Number(amount) / 10 ** stockForMint(mint).decimals).toFixed(6);

const allocation = allocate(PAYMENT, rule);
console.log(`Stashing 20% of ${formatUsdc(PAYMENT)} = ${formatUsdc(allocation.stashUsdc)}`);
allocation.legs.forEach((l) => console.log(`  ${l.symbol.padEnd(6)} ${formatUsdc(l.usdc)}`));

const mints = allocation.legs.map((l) => l.mint);
const before = {
  usdc: await balance(owner, USDC_MINT),
  stocks: await Promise.all(mints.map((m) => balance(owner, m))),
  fees: await Promise.all(mints.map((m) => tokenAccountBalance(treasuryFeeAccount(treasury, m)))),
};

const built = await buildBasket({ connection, owner, treasury, allocation });
console.log(`\nBuilt one transaction: ${built.bytes} / 1232 bytes, ${built.accounts} / 64 accounts, ${built.instructions} instructions`);
built.warnings.forEach((w) => console.log(`  warning: ${w}`));

built.transaction.sign([wallet]);

const sim = await connection.simulateTransaction(built.transaction, { sigVerify: true });
if (sim.value.err) {
  console.log(`\nSimulation FAILED: ${JSON.stringify(sim.value.err)}`);
  (sim.value.logs ?? []).slice(-25).forEach((l) => console.log(`  ${l}`));
  process.exit(1);
}
console.log(`Simulated: ${sim.value.unitsConsumed} compute units`);

const signature = await connection.sendRawTransaction(built.transaction.serialize(), { skipPreflight: true });
const confirmation = await connection.confirmTransaction(signature, "confirmed");
if (confirmation.value.err) {
  console.log(`\nSent but FAILED on chain: ${JSON.stringify(confirmation.value.err)}\n  ${signature}`);
  process.exit(1);
}

const after = {
  usdc: await balance(owner, USDC_MINT),
  stocks: await Promise.all(mints.map((m) => balance(owner, m))),
  fees: await Promise.all(mints.map((m) => tokenAccountBalance(treasuryFeeAccount(treasury, m)))),
};

console.log(`\nLanded: ${signature}`);
console.log(`  USDC   ${formatUsdc(before.usdc)} -> ${formatUsdc(after.usdc)}  (spent ${formatUsdc(before.usdc - after.usdc)})`);
mints.forEach((m, i) => {
  const s = stockForMint(m).symbol.padEnd(6);
  console.log(
    `  ${s} +${shares(after.stocks[i]! - before.stocks[i]!, m)} shares   ` +
      `treasury fee +${shares(after.fees[i]! - before.fees[i]!, m)}`,
  );
});

const spent = before.usdc - after.usdc;
if (spent !== allocation.stashUsdc) {
  console.log(`\nMISMATCH: spent ${formatUsdc(spent)}, expected ${formatUsdc(allocation.stashUsdc)}`);
  process.exitCode = 1;
}
if (STOCKS.length === 0) process.exitCode = 1;
