/**
 * A real USDC transfer on the fork, from a test payer to the user. Setting a
 * balance with a cheatcode isn't a transaction, so payment detection would
 * never see it.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { USDC_DECIMALS, USDC_MINT } from "@stash/core";

/** Sends `amount` USDC base units from `payer` to `to` and returns the signature. */
export async function sendUsdc(connection: Connection, payer: Keypair, to: string, amount: bigint): Promise<string> {
  const mint = new PublicKey(USDC_MINT);
  const recipient = new PublicKey(to);
  const fromAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, recipient, false, TOKEN_PROGRAM_ID);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, toAta, recipient, mint, TOKEN_PROGRAM_ID),
      createTransferCheckedInstruction(fromAta, mint, toAta, payer.publicKey, amount, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  const signature = await connection.sendRawTransaction(tx.serialize());
  const result = await connection.confirmTransaction(signature, "confirmed");
  if (result.value.err) throw new Error(`Payment failed on the fork: ${JSON.stringify(result.value.err)}`);
  return signature;
}
