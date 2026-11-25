/**
 * Checking a transaction the user signed before the server sends it.
 *
 * The server builds a stash or a sale and hands the browser an unsigned
 * transaction. The browser signs it with the user's wallet and sends it back.
 * Before anything goes to the network, the server confirms two things:
 *
 *   1. The message is byte-for-byte the one it built. A client cannot return
 *      a different transaction (another amount, another token, another
 *      recipient) under the same build.
 *   2. The owner's signature over that message is valid.
 *
 * The server never holds the user's key, so this is the only point where it
 * can be sure what it is about to send.
 */
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";

export interface VerifiedTransaction {
  transaction: VersionedTransaction;
}

/** Throws with a plain reason if the signed transaction may not be sent. */
export function verifySignedTransaction(
  expectedMessage: Uint8Array,
  signedBase64: string,
  owner: string,
): VerifiedTransaction {
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64"));
  } catch {
    throw new Error("That is not a valid signed transaction.");
  }

  const message = transaction.message.serialize();
  if (message.length !== expectedMessage.length || !Buffer.from(message).equals(Buffer.from(expectedMessage))) {
    throw new Error("The signed transaction is not the one Stash built. Nothing was sent.");
  }

  const ownerKey = new PublicKey(owner);
  const index = transaction.message.staticAccountKeys.findIndex((k) => k.equals(ownerKey));
  if (index < 0 || index >= transaction.message.header.numRequiredSignatures) {
    throw new Error("This transaction does not need the owner's signature. Nothing was sent.");
  }
  const signature = transaction.signatures[index];
  if (!signature || signature.every((b) => b === 0)) {
    throw new Error("The transaction has not been signed by the wallet.");
  }
  if (!ed25519.verify(signature, message, ownerKey.toBytes())) {
    throw new Error("The wallet's signature does not match. Nothing was sent.");
  }
  return { transaction };
}
