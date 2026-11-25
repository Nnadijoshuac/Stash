/**
 * A real USDC payment on the fork, from a test "payer" to the user.
 *
 * Writing a balance with a cheatcode is not a transaction, so nothing reading
 * the chain would ever see it as money arriving. A payer that actually sends
 * a token transfer makes the fork behave like a client, an employer or a
 * hackathon paying the user, which is what payment detection has to find.
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

/** Sends `amount` USDC base units from `payer` to `to`. Returns the signature. */
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
