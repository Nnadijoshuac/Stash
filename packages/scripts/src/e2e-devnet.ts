/**
 * Checks the Stash program that's deployed on devnet, with no fork involved.
 * A new wallet is funded from keys/deployer.json. It saves a rule, records
 * a stash for one payment, then tries to record the same payment again and
 * to record an amount the rule doesn't allow. Both must fail on chain.
 *
 * The program doesn't read the payment itself (the app does), so any 64-byte
 * signature works as the payment id here.
 *
 * Run: pnpm devnet
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  STASH_PROGRAM_ID,
  fetchOnChainRule,
  isStashedOnChain,
  recordStashInstruction,
  ruleAmount,
  setRuleInstruction,
} from "@stash/core";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDA = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const connection = new Connection(RPC, "confirmed");
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(new URL("../../../keys/deployer.json", import.meta.url), "utf8"))),
);
const owner = Keypair.generate();
let failures = 0;

async function send(label: string, ...ixs: TransactionInstruction[]): Promise<string> {
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [owner], {
    commitment: "confirmed",
  });
  console.log(`  ${label}: ${sig}`);
  return sig;
}

async function refused(label: string, ...ixs: TransactionInstruction[]): Promise<void> {
  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [owner], {
      commitment: "confirmed",
      skipPreflight: false,
    });
    failures++;
    console.log(`  NOT REFUSED: ${label} (${sig})`);
  } catch (e) {
    const logs = (e as { logs?: string[] }).logs ?? [];
    const reason = logs.find((l) => l.includes("Error") || l.includes("already in use")) ?? String(e).split("\n")[0];
    console.log(`  refused: ${label} -> ${reason}`);
  }
}

const executable = (await connection.getAccountInfo(STASH_PROGRAM_ID))?.executable;
if (!executable) throw new Error(`No program at ${STASH_PROGRAM_ID.toBase58()} on ${RPC}.`);
console.log(`Program ${STASH_PROGRAM_ID.toBase58()} is deployed on devnet.`);
console.log(`Test wallet: ${owner.publicKey.toBase58()}`);

await sendAndConfirmTransaction(
  connection,
  new Transaction().add(
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: owner.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }),
  ),
  [deployer],
  { commitment: "confirmed" },
);

const rule = { stashBps: 2000, basket: [{ mint: SPY, weightBps: 6000 }, { mint: NVDA, weightBps: 4000 }] };
await send("rule saved", setRuleInstruction(owner.publicKey, rule));
const stored = await fetchOnChainRule(connection, owner.publicKey);
console.log(`  read back: ${JSON.stringify(stored)}`);
if (JSON.stringify(stored) !== JSON.stringify(rule)) {
  failures++;
  console.log("  NOT EQUAL to the rule that was sent");
}

const payment = bs58.encode(randomBytes(64));
const paid = 500_000_000n;
const slice = ruleAmount(paid, rule.stashBps);
await send(`$${Number(slice) / 1e6} of a $500 payment recorded`, recordStashInstruction(owner.publicKey, payment, paid, slice));
console.log(`  receipt exists: ${await isStashedOnChain(connection, owner.publicKey, payment)}`);

await refused("the same payment stashed twice", recordStashInstruction(owner.publicKey, payment, paid, slice));
const other = bs58.encode(randomBytes(64));
await refused("an amount the rule doesn't allow ($150 of $500 at 20%)", recordStashInstruction(owner.publicKey, other, paid, 150_000_000n));
await refused(
  "a rule naming a stock that isn't verified",
  setRuleInstruction(owner.publicKey, { stashBps: 2000, basket: [{ mint: Keypair.generate().publicKey.toBase58(), weightBps: 10_000 }] }),
);

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll devnet checks passed.");
