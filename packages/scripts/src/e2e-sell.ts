/**
 * Sell part of a stock back to USDC, on the fork.
 *
 *   pnpm fund && pnpm stash && pnpm sell [SYMBOL] [percent]
 *
 * Sells half the wallet's NVDAx by default. Checks the USDC that arrived, the
 * fee in the treasury, and that the sale isn't counted as a payment.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  STOCKS,
  USDC_MINT,
  buildSell,
  formatUsdc,
  listIncomingPayments,
  sellAmount,
  treasuryUsdcFeeAccount,
} from "@stash/core";
import { SURFNET_RPC_URL, assertSurfnet, loadOrCreateKeypair, prepareForkForSend, protectedAccounts } from "@stash/fork";

const symbol = (process.argv[2] ?? "NVDAx").toUpperCase();
const percent = Number(process.argv[3] ?? 50);
const stock = STOCKS.find((s) => s.symbol.toUpperCase() === symbol);
if (!stock) throw new Error(`Unknown stock ${symbol}. Choose one of ${STOCKS.map((s) => s.symbol).join(", ")}.`);

await assertSurfnet();
const connection = new Connection(SURFNET_RPC_URL, "confirmed");
const wallet = loadOrCreateKeypair("wallet");
const treasury = loadOrCreateKeypair("treasury").publicKey.toBase58();
const owner = wallet.publicKey.toBase58();

async function balance(holder: string, mint: string): Promise<bigint> {
  const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(holder), { mint: new PublicKey(mint) });
  return res.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount as string), 0n);
}
const feeAccountBalance = async () => {
  const r = await connection.getTokenAccountBalance(new PublicKey(treasuryUsdcFeeAccount(treasury))).catch(() => null);
  return r ? BigInt(r.value.amount) : 0n;
};
const shares = (n: bigint) => (Number(n) / 10 ** stock.decimals).toFixed(6);

const holding = await balance(owner, stock.mint);
const amount = sellAmount(holding, Math.round(percent * 100));
console.log(`Selling ${percent}% of ${shares(holding)} ${stock.symbol} = ${shares(amount)} shares`);

const before = { usdc: await balance(owner, USDC_MINT), fee: await feeAccountBalance() };
const built = await buildSell({ connection, owner, treasury, mint: stock.mint, amount });
const expected = BigInt(built.quote.outAmount);
console.log(`Quote: about ${formatUsdc(expected)} after Stash's ${built.quote.platformFee?.feeBps ?? 0} bps fee`);
console.log(`One transaction: ${built.bytes} / 1232 bytes, ${built.accounts} / 64 accounts`);

await prepareForkForSend(built.routeAccounts, protectedAccounts(owner, treasury));
built.transaction.sign([wallet]);
const sim = await connection.simulateTransaction(built.transaction, { sigVerify: true });
if (sim.value.err) {
  console.log(`\nSimulation FAILED: ${JSON.stringify(sim.value.err)}`);
  (sim.value.logs ?? []).slice(-15).forEach((l) => console.log(`  ${l}`));
  process.exit(1);
}
const sig = await connection.sendRawTransaction(built.transaction.serialize(), { skipPreflight: true });
const conf = await connection.confirmTransaction(sig, "confirmed");
if (conf.value.err) throw new Error(`Sale failed on chain: ${sig}`);

const after = { usdc: await balance(owner, USDC_MINT), fee: await feeAccountBalance(), stock: await balance(owner, stock.mint) };
console.log(`\nSold: ${sig}`);
console.log(`  ${stock.symbol}  ${shares(holding)} -> ${shares(after.stock)} shares (sold ${shares(holding - after.stock)})`);
console.log(`  USDC   ${formatUsdc(before.usdc)} -> ${formatUsdc(after.usdc)} (+${formatUsdc(after.usdc - before.usdc)})`);
console.log(`  treasury fee +${formatUsdc(after.fee - before.fee)} USDC; ${sim.value.unitsConsumed} CU`);

if (holding - after.stock !== amount) {
  console.log(`\nMISMATCH: sold ${holding - after.stock}, expected ${amount}`);
  process.exitCode = 1;
}
const payments = await listIncomingPayments(connection, owner, { limit: 10 });
if (payments.some((p) => p.signature === sig)) {
  console.log("\nFAILED: the sale was counted as an incoming payment.");
  process.exitCode = 1;
} else {
  console.log("The sale is correctly not counted as an incoming payment.");
}
