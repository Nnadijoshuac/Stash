import { createHash } from "node:crypto";
import bs58 from "bs58";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  STASH_PROGRAM_ID,
  paymentId,
  receiptPda,
  recordStashInstruction,
  ruleAmount,
  rulePda,
  setRuleInstruction,
} from "./program";

const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDA = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const owner = Keypair.generate().publicKey;
const sigA = bs58.encode(Buffer.alloc(64, 1));
const sigB = bs58.encode(Buffer.concat([Buffer.alloc(32, 1), Buffer.alloc(32, 2)]));
const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

describe("stash program client", () => {
  it("encodes set_rule as Anchor expects: discriminator, u16 share, then a Borsh vec of (mint, u16)", () => {
    const ix = setRuleInstruction(owner, {
      stashBps: 2_000,
      basket: [
        { mint: SPY, weightBps: 6_000 },
        { mint: NVDA, weightBps: 4_000 },
      ],
    });
    expect(ix.programId.equals(STASH_PROGRAM_ID)).toBe(true);
    expect(ix.data.subarray(0, 8).equals(disc("set_rule"))).toBe(true);
    expect(ix.data.readUInt16LE(8)).toBe(2_000);
    expect(ix.data.readUInt32LE(10)).toBe(2);
    expect(ix.data.length).toBe(8 + 2 + 4 + 2 * 34);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      owner.toBase58(),
      rulePda(owner).toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
  });

  it("encodes record_stash with the payment id and both amounts, 56 bytes", () => {
    const ix = recordStashInstruction(owner, sigA, 500_000_000n, 100_000_000n);
    expect(ix.data.subarray(0, 8).equals(disc("record_stash"))).toBe(true);
    expect(ix.data.subarray(8, 40).equals(paymentId(sigA))).toBe(true);
    expect(ix.data.readBigUInt64LE(40)).toBe(500_000_000n);
    expect(ix.data.readBigUInt64LE(48)).toBe(100_000_000n);
    expect(ix.data.length).toBe(56);
    expect(ix.keys[2]!.pubkey.equals(receiptPda(owner, sigA))).toBe(true);
    expect(ix.keys[2]!.isWritable).toBe(true);
  });

  it("gives each payment its own receipt address, so one payment can only be stashed once", () => {
    expect(receiptPda(owner, sigA).equals(receiptPda(owner, sigA))).toBe(true);
    const otherOwner = Keypair.generate().publicKey;
    expect(receiptPda(owner, sigA).equals(receiptPda(otherOwner, sigA))).toBe(false);
  });

  it("identifies a payment by the first 32 bytes of its signature", () => {
    // sigA and sigB share their first 32 bytes, so they share a receipt. Two
    // real signatures colliding on 32 bytes is not a practical concern.
    expect(paymentId(sigA).equals(paymentId(sigB))).toBe(true);
    expect(() => paymentId("not-a-signature")).toThrow();
  });

  it("rounds the rule's share down, the same way the program does", () => {
    expect(ruleAmount(500_000_000n, 2_000)).toBe(100_000_000n);
    expect(ruleAmount(333n, 2_000)).toBe(66n);
  });
});
