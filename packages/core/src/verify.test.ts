import { describe, expect, it } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { verifySignedTransaction } from "./verify";

const BLOCKHASH = "11111111111111111111111111111111";
const owner = Keypair.generate();
const stranger = Keypair.generate();

function build(payer = owner.publicKey, lamports = 1_000): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: stranger.publicKey, lamports })],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

describe("verifySignedTransaction", () => {
  it("accepts the exact transaction the server built, signed by the owner", () => {
    const built = build();
    const expected = built.message.serialize();
    built.sign([owner]);
    expect(() => verifySignedTransaction(expected, b64(built), owner.publicKey.toBase58())).not.toThrow();
  });

  it("refuses a different transaction under the same build, even if properly signed", () => {
    const expected = build().message.serialize();
    const swapped = build(owner.publicKey, 999_999);
    swapped.sign([owner]);
    expect(() => verifySignedTransaction(expected, b64(swapped), owner.publicKey.toBase58())).toThrow(
      /not the one Stash built/,
    );
  });

  it("refuses an unsigned transaction", () => {
    const built = build();
    expect(() => verifySignedTransaction(built.message.serialize(), b64(built), owner.publicKey.toBase58())).toThrow(
      /not been signed/,
    );
  });

  it("refuses a signature made by a different key", () => {
    const built = build();
    const expected = built.message.serialize();
    const forged = Keypair.generate();
    built.signatures[0] = new Uint8Array(Buffer.from(forged.secretKey.slice(0, 64)));
    expect(() => verifySignedTransaction(expected, b64(built), owner.publicKey.toBase58())).toThrow(
      /signature does not match/,
    );
  });

  it("refuses when the claimed owner is not a signer of the transaction", () => {
    const built = build();
    const expected = built.message.serialize();
    built.sign([owner]);
    expect(() => verifySignedTransaction(expected, b64(built), stranger.publicKey.toBase58())).toThrow(
      /does not need the owner's signature/,
    );
  });

  it("refuses bytes that are not a transaction at all", () => {
    expect(() => verifySignedTransaction(new Uint8Array(10), "bm90IGEgdHg=", owner.publicKey.toBase58())).toThrow(
      /not a valid signed transaction/,
    );
  });
});
