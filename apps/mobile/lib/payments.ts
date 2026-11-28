/**
 * Finds USDC payments into the wallet, using the same rule as the web app
 * (packages/core/src/payments.ts): the transaction succeeded, the wallet's
 * USDC went up, and the wallet didn't sign it. Anything the wallet signed is
 * its own stash or transfer, not a payment.
 */
import { Connection, ParsedTransactionWithMeta, PublicKey, TokenBalance } from '@solana/web3.js'
import { USDC_MINT, usdcAccount } from '@/lib/stash'

export interface Payment {
  signature: string
  amountUsdc: bigint
  from: string | null
  blockTime: number | null
}

const MINT = USDC_MINT.toBase58()

function sum(balances: TokenBalance[] | null | undefined, owner: string): bigint {
  return (balances ?? [])
    .filter((b) => b.mint === MINT && b.owner === owner)
    .reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n)
}

export function incoming(tx: ParsedTransactionWithMeta, owner: string): Payment | null {
  if (!tx.meta || tx.meta.err) return null
  const signers = tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey.toBase58())
  if (signers.includes(owner)) return null
  const received = sum(tx.meta.postTokenBalances, owner) - sum(tx.meta.preTokenBalances, owner)
  if (received <= 0n) return null
  const senders = new Set<string>()
  for (const pre of tx.meta.preTokenBalances ?? []) {
    if (pre.mint !== MINT || !pre.owner || pre.owner === owner) continue
    if (sum(tx.meta.postTokenBalances, pre.owner) < sum(tx.meta.preTokenBalances, pre.owner)) senders.add(pre.owner)
  }
  return {
    signature: tx.transaction.signatures[0],
    amountUsdc: received,
    from: senders.size === 1 ? [...senders][0] : null,
    blockTime: tx.blockTime ?? null,
  }
}

/** Recent payments, newest first. */
export async function listPayments(connection: Connection, owner: PublicKey, limit = 15): Promise<Payment[]> {
  const sigs = await connection.getSignaturesForAddress(usdcAccount(owner), { limit }, 'confirmed')
  const ok = sigs.filter((s) => !s.err).map((s) => s.signature)
  if (ok.length === 0) return []
  const txs = await connection.getParsedTransactions(ok, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
  const me = owner.toBase58()
  return txs.flatMap((tx) => {
    const p = tx ? incoming(tx, me) : null
    return p ? [p] : []
  })
}
