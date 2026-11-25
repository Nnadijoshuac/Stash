/**
 * Finding the payments a user receives, so each one can be stashed.
 *
 * "Every payment you receive" is the promise, so a payment has to be read off
 * the chain, not typed in. A transaction counts as an incoming payment when:
 *   - it succeeded,
 *   - the user's USDC balance went up in it, and
 *   - the user did not sign it. Anything the user signed (a stash, a swap
 *     back to USDC, a transfer between their own accounts) is their own
 *     action, not money arriving.
 *
 * The amount always comes from the chain. A stash is later tied to the
 * payment's signature, so the client never gets to name how much it was.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from "./ata";
import { USDC_MINT } from "./constants";

/** The parts of a parsed transaction this module reads. */
export interface TokenBalanceLike {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}
export interface ParsedTxLike {
  slot: number;
  blockTime?: number | null;
  meta: { err: unknown; preTokenBalances?: TokenBalanceLike[] | null; postTokenBalances?: TokenBalanceLike[] | null } | null;
  transaction: {
    signatures: string[];
    message: { accountKeys: { pubkey: { toBase58(): string } | string; signer: boolean }[] };
  };
}

export interface IncomingPayment {
  signature: string;
  /** USDC base units received. */
  amountUsdc: bigint;
  /** The wallet whose USDC went down in the same transaction, if exactly one did. */
  from: string | null;
  slot: number;
  blockTime: number | null;
}

function sumUsdc(balances: TokenBalanceLike[] | null | undefined, owner: string): bigint {
  return (balances ?? [])
    .filter((b) => b.mint === USDC_MINT && b.owner === owner)
    .reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
}

const keyString = (k: { toBase58(): string } | string) => (typeof k === "string" ? k : k.toBase58());

/** Pure. Returns the payment `owner` received in `tx`, or null if it was not one. */
export function incomingUsdc(tx: ParsedTxLike, owner: string): IncomingPayment | null {
  if (!tx.meta || tx.meta.err) return null;
  const signers = tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => keyString(k.pubkey));
  if (signers.includes(owner)) return null;

  const received = sumUsdc(tx.meta.postTokenBalances, owner) - sumUsdc(tx.meta.preTokenBalances, owner);
  if (received <= 0n) return null;

  const senders = new Set<string>();
  for (const pre of tx.meta.preTokenBalances ?? []) {
    if (pre.mint !== USDC_MINT || !pre.owner || pre.owner === owner) continue;
    if (sumUsdc(tx.meta.postTokenBalances, pre.owner) < sumUsdc(tx.meta.preTokenBalances, pre.owner)) {
      senders.add(pre.owner);
    }
  }

  return {
    signature: tx.transaction.signatures[0]!,
    amountUsdc: received,
    from: senders.size === 1 ? [...senders][0]! : null,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
  };
}

/**
 * Reads the most recent transactions touching the user's USDC account and
 * returns the incoming payments among them, newest first.
 *
 * Only the associated USDC account is watched. That is where wallets and
 * exchanges send USDC; money sent to some other token account the user
 * happens to own would not be seen, and the README says so.
 */
export async function listIncomingPayments(
  connection: Connection,
  owner: string,
  options: { limit?: number } = {},
): Promise<IncomingPayment[]> {
  const usdcAccount = associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM_ID);
  const sigs = await connection.getSignaturesForAddress(new PublicKey(usdcAccount), { limit: options.limit ?? 25 });
  if (sigs.length === 0) return [];
  const txs = await connection.getParsedTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  );
  return txs
    .map((tx) => (tx ? incomingUsdc(tx as unknown as ParsedTxLike, owner) : null))
    .filter((p): p is IncomingPayment => p !== null);
}

/** Looks up one payment by signature, re-reading it from the chain. */
export async function getIncomingPayment(
  connection: Connection,
  owner: string,
  signature: string,
): Promise<IncomingPayment | null> {
  const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  return tx ? incomingUsdc(tx as unknown as ParsedTxLike, owner) : null;
}
