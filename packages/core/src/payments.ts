/**
 * Finds the payments a wallet received. A transaction counts if it succeeded,
 * the wallet's USDC went up, and the wallet didn't sign it (anything it signed
 * is its own stash, sale or transfer). The amount always comes from the chain,
 * never from the browser.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from "./ata";
import { USDC_MINT } from "./constants";

/** The parts of a parsed transaction we read. */
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
  /** Who paid, if exactly one wallet's USDC went down. */
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

/** The payment `owner` received in `tx`, or null. No network calls. */
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
 * Recent payments into the wallet's USDC account, newest first. Only the
 * associated USDC account is watched; USDC sent to another account it owns
 * won't show up.
 */
export async function listIncomingPayments(
  connection: Connection,
  owner: string,
  options: { limit?: number } = {},
): Promise<IncomingPayment[]> {
  const usdcAccount = associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM_ID);
  const sigs = await connection.getSignaturesForAddress(new PublicKey(usdcAccount), { limit: options.limit ?? 25 });
  if (sigs.length === 0) return [];
  // One request per transaction. getParsedTransactions sends a JSON-RPC batch,
  // which surfpool doesn't support. Failed transactions can't be payments, so
  // skip them first.
  const txs = await Promise.all(
    sigs
      .filter((s) => !s.err)
      .map((s) =>
        connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }),
      ),
  );
  const payments = txs
    .map((tx) => (tx ? incomingUsdc(tx as unknown as ParsedTxLike, owner) : null))
    .filter((p): p is IncomingPayment => p !== null);
  return Promise.all(payments.map((p) => withPlausibleTime(connection, p)));
}

/** 2001-09-09. Anything earlier than this is a bad timestamp. */
const EARLIEST_PLAUSIBLE_BLOCK_TIME = 1_000_000_000;

/**
 * Surfpool's getTransaction returns blockTime divided by 1,000, which puts
 * fork payments in 1970. If the time is impossible, ask getBlockTime(slot).
 */
async function withPlausibleTime(connection: Connection, p: IncomingPayment): Promise<IncomingPayment> {
  if (p.blockTime !== null && p.blockTime >= EARLIEST_PLAUSIBLE_BLOCK_TIME) return p;
  const blockTime = await connection.getBlockTime(p.slot).catch(() => null);
  return { ...p, blockTime: blockTime !== null && blockTime >= EARLIEST_PLAUSIBLE_BLOCK_TIME ? blockTime : null };
}

/** One payment by signature, read from the chain again. */
export async function getIncomingPayment(
  connection: Connection,
  owner: string,
  signature: string,
): Promise<IncomingPayment | null> {
  const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const payment = tx ? incomingUsdc(tx as unknown as ParsedTxLike, owner) : null;
  return payment ? withPlausibleTime(connection, payment) : null;
}
