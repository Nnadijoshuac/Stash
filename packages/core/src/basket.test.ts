import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { packBasket } from "./basket";

const BLOCKHASH = "11111111111111111111111111111111";
const owner = Keypair.generate().publicKey;
const program = Keypair.generate().publicKey;

/** An instruction touching `n` fresh accounts, like a swap with no lookup table. */
function wideInstruction(n: number): TransactionInstruction {
  return new TransactionInstruction({
    programId: program,
    keys: Array.from({ length: n }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true })),
    data: Buffer.from([1, 2, 3]),
  });
}

describe("packBasket", () => {
  it("packs small legs into one transaction and reports its size", () => {
    const p = packBasket({
      owner,
      setup: [[], []],
      swaps: [wideInstruction(4), wideInstruction(4)],
      lookupTables: [],
      recentBlockhash: BLOCKHASH,
    });
    expect(p.instructions).toBe(4); // two compute-budget instructions plus two swaps
    expect(p.bytes).toBeLessThanOrEqual(1232);
    expect(p.warnings).toEqual([]);
  });

  it("keeps one copy of a setup instruction that two legs both need", () => {
    const shared = new TransactionInstruction({
      programId: program,
      keys: [{ pubkey: owner, isSigner: true, isWritable: true }],
      data: Buffer.from([9]),
    });
    const p = packBasket({
      owner,
      setup: [[shared], [shared]],
      swaps: [wideInstruction(2), wideInstruction(2)],
      lookupTables: [],
      recentBlockhash: BLOCKHASH,
    });
    expect(p.instructions).toBe(5); // 2 compute budget + 1 shared setup + 2 swaps
  });

  it("refuses a basket that needs more than 64 accounts", () => {
    expect(() =>
      packBasket({
        owner,
        setup: [[], []],
        swaps: [wideInstruction(35), wideInstruction(35)],
        lookupTables: [],
        recentBlockhash: BLOCKHASH,
      }),
    ).toThrow(/accounts; a transaction allows 64/);
  });

  it("refuses a basket larger than 1,232 bytes, with the measured size", () => {
    const bulky = new TransactionInstruction({ programId: program, keys: [], data: Buffer.alloc(1200) });
    expect(() =>
      packBasket({ owner, setup: [[]], swaps: [bulky], lookupTables: [], recentBlockhash: BLOCKHASH }),
    ).toThrow(/over 1232 bytes|bytes; a transaction allows 1232/);
  });

  it("warns when a basket fits but is close to the limit", () => {
    const nearLimit = new TransactionInstruction({ programId: program, keys: [], data: Buffer.alloc(950) });
    const p = packBasket({ owner, setup: [[]], swaps: [nearLimit], lookupTables: [], recentBlockhash: BLOCKHASH });
    expect(p.bytes).toBeGreaterThan(1150);
    expect(p.warnings[0]).toMatch(/Close to the size limit/);
  });

  it("makes the stash owner the fee payer and only signer", () => {
    const p = packBasket({ owner, setup: [[]], swaps: [wideInstruction(2)], lookupTables: [], recentBlockhash: BLOCKHASH });
    const msg = p.transaction.message;
    expect(msg.header.numRequiredSignatures).toBe(1);
    expect(msg.staticAccountKeys[0]!.equals(new PublicKey(owner))).toBe(true);
  });
});
