/**
 * Checks a transaction the browser signed before we send it. It has to be
 * byte for byte what we built, and signed by the owner. The server never has
 * the user's key, so this is where we make sure we only send what we built.
 */
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";

export interface VerifiedTransaction {
  transaction: VersionedTransaction;
}

/** Throws with the reason if the signed transaction can't be sent. */
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
