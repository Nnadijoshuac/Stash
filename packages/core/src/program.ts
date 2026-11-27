/**
 * Client for Stash's on-chain program (`programs/stash`, Anchor).
 *
 * The program holds two things on Solana:
 * - each wallet's stash rule, at PDA ["rule", owner];
 * - a receipt per stashed payment, at PDA ["stash", owner, paymentId],
 *   created inside the same atomic transaction as the Jupiter swaps. A second
 *   stash of the same payment cannot create its receipt, so the whole
 *   transaction fails on chain.
 *
 * Instructions are encoded by hand (Anchor's 8-byte discriminator, then Borsh)
 * so the app needs no extra dependency and every byte is visible: transaction
 * size is Stash's tightest budget.
 */
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { PublicKey, SystemProgram, TransactionInstruction, type Connection } from "@solana/web3.js";
import type { StashRule } from "./allocation";
import { FULL_WEIGHT_BPS } from "./constants";

/** Deployed on devnet, and loaded into the local mainnet fork by `pnpm fund`. */
export const STASH_PROGRAM_ID = new PublicKey("7G66DnGnvPBaAr4hWNhno1ZDeAuh2bvcFmKm5UiZu7oJ");

function discriminator(namespace: "global" | "account" | "event", name: string): Buffer {
  return createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}

const SET_RULE = discriminator("global", "set_rule");
const RECORD_STASH = discriminator("global", "record_stash");
const RULE_ACCOUNT = discriminator("account", "StashRule");

export function rulePda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("rule"), owner.toBuffer()], STASH_PROGRAM_ID)[0];
}

/** The first 32 bytes of the payment's transaction signature identify it. */
export function paymentId(paymentSignature: string): Buffer {
  const raw = Buffer.from(bs58.decode(paymentSignature));
  if (raw.length !== 64) throw new Error("That is not a Solana transaction signature.");
  return raw.subarray(0, 32);
}

export function receiptPda(owner: PublicKey, paymentSignature: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stash"), owner.toBuffer(), paymentId(paymentSignature)],
    STASH_PROGRAM_ID,
  )[0];
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

/** Creates or replaces the owner's rule on chain. Signed by the owner. */
export function setRuleInstruction(owner: PublicKey, rule: StashRule): TransactionInstruction {
  const data = Buffer.concat([
    SET_RULE,
    u16(rule.stashBps),
    u32(rule.basket.length),
    ...rule.basket.flatMap((w) => [new PublicKey(w.mint).toBuffer(), u16(w.weightBps)]),
  ]);
  return new TransactionInstruction({
    programId: STASH_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: rulePda(owner), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Records one stashed payment. Goes in the same transaction as the swaps. */
export function recordStashInstruction(
  owner: PublicKey,
  paymentSignature: string,
  paymentUsdc: bigint,
  stashUsdc: bigint,
): TransactionInstruction {
  const data = Buffer.concat([RECORD_STASH, paymentId(paymentSignature), u64(paymentUsdc), u64(stashUsdc)]);
  return new TransactionInstruction({
    programId: STASH_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: rulePda(owner), isSigner: false, isWritable: false },
      { pubkey: receiptPda(owner, paymentSignature), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Reads the owner's rule from chain, or null if they have not set one. */
export async function fetchOnChainRule(connection: Connection, owner: PublicKey): Promise<StashRule | null> {
  const info = await connection.getAccountInfo(rulePda(owner), "confirmed");
  if (!info || !info.owner.equals(STASH_PROGRAM_ID)) return null;
  const d = info.data;
  if (!d.subarray(0, 8).equals(RULE_ACCOUNT)) return null;
  let o = 8 + 32; // discriminator, owner
  const stashBps = d.readUInt16LE(o);
  o += 2;
  const n = d.readUInt32LE(o);
  o += 4;
  const basket: StashRule["basket"] = [];
  for (let i = 0; i < n; i++) {
    basket.push({ mint: new PublicKey(d.subarray(o, o + 32)).toBase58(), weightBps: d.readUInt16LE(o + 32) });
    o += 34;
  }
  return { stashBps, basket };
}

/** True once a receipt exists for this payment, i.e. it was stashed. */
export async function isStashedOnChain(
  connection: Connection,
  owner: PublicKey,
  paymentSignature: string,
): Promise<boolean> {
  const info = await connection.getAccountInfo(receiptPda(owner, paymentSignature), "confirmed");
  return info !== null && info.owner.equals(STASH_PROGRAM_ID);
}

/** The program's check, mirrored: the rule's share of a payment, rounded down. */
export function ruleAmount(paymentUsdc: bigint, stashBps: number): bigint {
  return (paymentUsdc * BigInt(stashBps)) / BigInt(FULL_WEIGHT_BPS);
}
