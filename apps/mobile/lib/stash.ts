/**
 * The phone's client for the Stash program on devnet. It encodes the same two
 * instructions as packages/core/src/program.ts. That file hashes the Anchor
 * discriminators with node:crypto, which React Native doesn't have, so the
 * hashes are written out here. program.test.ts checks the same bytes.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeAccount3Instruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import bs58 from 'bs58'

/** Same program id as on the web app's fork. */
export const STASH_PROGRAM_ID = new PublicKey('7G66DnGnvPBaAr4hWNhno1ZDeAuh2bvcFmKm5UiZu7oJ')

/** Circle's devnet USDC. Free from faucet.circle.com. */
export const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
export const USDC_DECIMALS = 6

/** sha256("global:set_rule"), sha256("global:record_stash"), sha256("account:StashRule"), first 8 bytes each. */
const SET_RULE = Buffer.from('ed94b2ac7f467267', 'hex')
const RECORD_STASH = Buffer.from('aa42f28feda8b5a5', 'hex')
const RULE_ACCOUNT = Buffer.from('d70f67ac5fc8f5ed', 'hex')

/** The program only accepts these five mints. Same list as programs/stash. */
export const STOCKS = [
  { symbol: 'SPYx', tracks: 'S&P 500', mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W' },
  { symbol: 'QQQx', tracks: 'Nasdaq 100', mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ' },
  { symbol: 'NVDAx', tracks: 'Nvidia', mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh' },
  { symbol: 'TSLAx', tracks: 'Tesla', mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB' },
  { symbol: 'AAPLx', tracks: 'Apple', mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp' },
] as const

export interface Rule {
  stashBps: number
  basket: { mint: string; weightBps: number }[]
}

export function rulePda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('rule'), owner.toBuffer()], STASH_PROGRAM_ID)[0]
}

function paymentId(signature: string): Buffer {
  const raw = Buffer.from(bs58.decode(signature))
  if (raw.length !== 64) throw new Error('That is not a Solana transaction signature.')
  return raw.subarray(0, 32)
}

export function receiptPda(owner: PublicKey, signature: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stash'), owner.toBuffer(), paymentId(signature)],
    STASH_PROGRAM_ID,
  )[0]
}

/**
 * Devnet has no xStocks and no Jupiter, so the phone can't buy stock there.
 * Instead the slice moves into a second USDC account that the wallet owns,
 * derived from the wallet and a fixed seed. Nobody else can move it.
 */
const STASH_SEED = 'stash-usdc'
export async function stashAccountAddress(owner: PublicKey): Promise<PublicKey> {
  return await PublicKey.createWithSeed(owner, STASH_SEED, TOKEN_PROGRAM_ID)
}

export function usdcAccount(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(USDC_MINT, owner)
}

// Joins byte arrays. Buffer.concat would do, but its types clash with
// TypeScript 6's Uint8Array under React Native's Buffer polyfill.
function bytes(...parts: ArrayLike<number>[]): Buffer {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return Buffer.from(out)
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(n)
  return b
}

export function setRuleInstruction(owner: PublicKey, rule: Rule): TransactionInstruction {
  return new TransactionInstruction({
    programId: STASH_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: rulePda(owner), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: bytes(
      SET_RULE,
      u16(rule.stashBps),
      u32(rule.basket.length),
      ...rule.basket.flatMap((w) => [new PublicKey(w.mint).toBytes(), u16(w.weightBps)]),
    ),
  })
}

export function recordStashInstruction(
  owner: PublicKey,
  signature: string,
  paymentUsdc: bigint,
  stashUsdc: bigint,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: STASH_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: rulePda(owner), isSigner: false, isWritable: false },
      { pubkey: receiptPda(owner, signature), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: bytes(RECORD_STASH, paymentId(signature), u64(paymentUsdc), u64(stashUsdc)),
  })
}

export async function fetchRule(connection: Connection, owner: PublicKey): Promise<Rule | null> {
  const info = await connection.getAccountInfo(rulePda(owner), 'confirmed')
  if (!info || !info.owner.equals(STASH_PROGRAM_ID)) return null
  const d = Buffer.from(info.data)
  if (!sameBytes(d.subarray(0, 8), RULE_ACCOUNT)) return null
  let o = 8 + 32
  const stashBps = d.readUInt16LE(o)
  o += 2
  const n = d.readUInt32LE(o)
  o += 4
  const basket: Rule['basket'] = []
  for (let i = 0; i < n; i++) {
    basket.push({ mint: new PublicKey(d.subarray(o, o + 32)).toBase58(), weightBps: d.readUInt16LE(o + 32) })
    o += 34
  }
  return { stashBps, basket }
}

/** Same rounding as the program: the rule's share, rounded down. */
export function ruleAmount(paymentUsdc: bigint, stashBps: number): bigint {
  return (paymentUsdc * BigInt(stashBps)) / 10_000n
}

async function legacyTransaction(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<{ transaction: VersionedTransaction; minContextSlot: number; blockhash: string; lastValidBlockHeight: number }> {
  const {
    context: { slot: minContextSlot },
    value: { blockhash, lastValidBlockHeight },
  } = await connection.getLatestBlockhashAndContext('confirmed')
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToLegacyMessage()
  return { transaction: new VersionedTransaction(message), minContextSlot, blockhash, lastValidBlockHeight }
}

export function buildRuleTransaction(connection: Connection, owner: PublicKey, rule: Rule) {
  return legacyTransaction(connection, owner, [setRuleInstruction(owner, rule)])
}

/**
 * One transaction: open the stash account if this is the first stash, move
 * the slice into it, and write the receipt. If the receipt already exists the
 * program refuses and the USDC doesn't move either.
 */
export async function buildStashTransaction(
  connection: Connection,
  owner: PublicKey,
  payment: { signature: string; amountUsdc: bigint },
  rule: Rule,
) {
  const stashUsdc = ruleAmount(payment.amountUsdc, rule.stashBps)
  if (stashUsdc <= 0n) throw new Error('This payment is too small to stash anything.')
  const stash = await stashAccountAddress(owner)
  const instructions: TransactionInstruction[] = []
  if (!(await connection.getAccountInfo(stash, 'confirmed'))) {
    instructions.push(
      SystemProgram.createAccountWithSeed({
        fromPubkey: owner,
        basePubkey: owner,
        seed: STASH_SEED,
        newAccountPubkey: stash,
        lamports: await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
        space: ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(stash, USDC_MINT, owner),
    )
  }
  instructions.push(
    createTransferCheckedInstruction(usdcAccount(owner), USDC_MINT, stash, owner, stashUsdc, USDC_DECIMALS),
    recordStashInstruction(owner, payment.signature, payment.amountUsdc, stashUsdc),
  )
  return { ...(await legacyTransaction(connection, owner, instructions)), stashUsdc }
}

/** Moves everything in the stash account back to the wallet's main USDC account. */
export async function buildWithdrawTransaction(connection: Connection, owner: PublicKey, amount: bigint) {
  const stash = await stashAccountAddress(owner)
  return legacyTransaction(connection, owner, [
    createTransferCheckedInstruction(stash, USDC_MINT, usdcAccount(owner), owner, amount, USDC_DECIMALS),
  ])
}

/** Which of these payments already have a receipt on chain. */
export async function stashedSignatures(connection: Connection, owner: PublicKey, signatures: string[]) {
  if (signatures.length === 0) return new Set<string>()
  const infos = await connection.getMultipleAccountsInfo(
    signatures.map((s) => receiptPda(owner, s)),
    'confirmed',
  )
  return new Set(signatures.filter((_, i) => infos[i]?.owner.equals(STASH_PROGRAM_ID)))
}

export async function tokenBalance(connection: Connection, account: PublicKey): Promise<bigint> {
  try {
    const r = await connection.getTokenAccountBalance(account, 'confirmed')
    return BigInt(r.value.amount)
  } catch {
    return 0n
  }
}

export function formatUsd(units: bigint): string {
  const cents = units / 10_000n
  const dollars = cents / 100n
  const rest = (cents % 100n).toString().padStart(2, '0')
  return `$${dollars.toLocaleString('en-US')}.${rest}`
}
