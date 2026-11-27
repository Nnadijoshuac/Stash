/**
 * End to end, against mainnet, without signing or sending anything.
 *
 * Runs the real core logic on real Jupiter quotes and real lookup tables:
 * allocate a payment by a rule, quote every leg with Stash's fee, pack the
 * legs into one transaction, and print what was built. This is the evidence
 * behind "the whole basket fits in one transaction".
 *
 *   pnpm basket-size
 *
 * The owner and treasury are throwaway addresses, so the owner has no token
 * accounts yet: the numbers are for a first-time user, the largest case.
 */
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { allocate, buildBasket, formatUsdc, stockForMint, type StashRule } from "@stash/core";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");
const owner = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();

/** `pnpm basket-size --receipt` also packs the on-chain stash receipt. */
const withReceipt = process.argv.includes("--receipt");
const SAMPLE_PAYMENT = bs58.encode(Buffer.alloc(64, 7));

const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDA = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TSLA = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

const cases: { label: string; paymentUsdc: bigint; rule: StashRule }[] = [
  {
    label: "20% of $500 -> 60% S&P 500, 40% Nvidia",
    paymentUsdc: 500_000_000n,
    rule: { stashBps: 2_000, basket: [{ mint: SPY, weightBps: 6_000 }, { mint: NVDA, weightBps: 4_000 }] },
  },
  {
    label: "20% of $500 -> 50% S&P 500, 30% Nvidia, 20% Tesla",
    paymentUsdc: 500_000_000n,
    rule: {
      stashBps: 2_000,
      basket: [{ mint: SPY, weightBps: 5_000 }, { mint: NVDA, weightBps: 3_000 }, { mint: TSLA, weightBps: 2_000 }],
    },
  },
];

for (const c of cases) {
  console.log(`\n${c.label}`);
  try {
    const allocation = allocate(c.paymentUsdc, c.rule);
    const built = await buildBasket({
      connection,
      owner,
      treasury,
      allocation,
      // A made-up payment signature: enough to measure the on-chain receipt's bytes.
      ...(withReceipt ? { paymentSignature: SAMPLE_PAYMENT } : {}),
    });
    allocation.legs.forEach((leg, i) => {
      const q = built.quotes[i]!;
      const stock = stockForMint(leg.mint);
      const shares = Number(q.outAmount) / 10 ** stock.decimals;
      const route = q.routePlan.map((r) => r.swapInfo.label ?? "?").join(" > ");
      console.log(
        `  ${stock.symbol.padEnd(6)} ${formatUsdc(leg.usdc).padStart(8)} -> ${shares.toFixed(6)} shares` +
          `  fee ${q.platformFee?.feeBps ?? 0} bps  via ${route}`,
      );
    });
    console.log(
      `  one transaction: ${built.bytes} / 1232 bytes, ${built.accounts} / 64 accounts, ${built.instructions} instructions`,
    );
    built.warnings.forEach((w) => console.log(`  warning: ${w}`));
  } catch (e) {
    console.log(`  FAILED: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
