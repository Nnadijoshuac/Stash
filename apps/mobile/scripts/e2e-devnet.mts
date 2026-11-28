/**
 * Runs the phone's and the web page's code end to end on devnet, with a
 * throwaway keypair standing in for the wallet:
 *   test payer pays $2 -> payment detected -> rule saved -> slice stashed
 *   -> receipt found -> second stash refused -> slice moved back.
 *
 * Needs keys/demo-payer.json (devnet only, gitignored) with devnet USDC.
 * Run from apps/mobile:  npx tsx scripts/e2e-devnet.mts
 */
import { readFileSync } from 'node:fs'
import bs58 from 'bs58'
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction, clusterApiUrl } from '@solana/web3.js'
import { listPayments } from '@/lib/payments'
import {
  buildRuleTransaction,
  buildStashTransaction,
  buildWithdrawTransaction,
  fetchRule,
  formatUsd,
  stashAccountAddress,
  stashedSignatures,
  tokenBalance,
  usdcAccount,
} from '@/lib/stash'
import * as payModule from '../web/pay'

// pay.ts compiles as CommonJS here, so its default export arrives wrapped.
const pay = ((payModule as { default: unknown }).default as { default?: unknown }).default ?? (payModule as { default: unknown }).default


const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
const payerFile = new URL('../../../keys/demo-payer.json', import.meta.url)
process.env.DEMO_PAYER_SECRET = bs58.encode(Uint8Array.from(JSON.parse(readFileSync(payerFile, 'utf8'))))
const wallet = Keypair.generate()
const owner = wallet.publicKey
let failures = 0
const check = (ok: boolean, label: string) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${label}`)
}

async function sign(built: { transaction: VersionedTransaction; blockhash: string; lastValidBlockHeight: number }) {
  built.transaction.sign([wallet])
  const sig = await connection.sendRawTransaction(built.transaction.serialize())
  const r = await connection.confirmTransaction({ signature: sig, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight }, 'confirmed')
  if (r.value.err) throw new Error(JSON.stringify(r.value.err))
  return sig
}

async function callPay(): Promise<{ status: number; body: { signature?: string; error?: string } }> {
  let status = 0
  let body = {}
  await (pay as (req: unknown, res: unknown) => Promise<void>)({ method: 'POST', body: JSON.stringify({ owner: owner.toBase58() }) }, {
    status(c: number) { status = c; return this },
    json(b: unknown) { body = b as object },
  })
  return { status, body }
}

console.log(`Throwaway wallet: ${owner.toBase58()}`)

const paid = await callPay()
check(paid.status === 200 && !!paid.body.signature, `test payer paid $2 and 0.02 SOL (${paid.body.signature ?? paid.body.error})`)
check((await connection.getBalance(owner)) >= 0.02 * LAMPORTS_PER_SOL, 'wallet got SOL for fees')

let payments = await listPayments(connection, owner)
for (let i = 0; i < 5 && !payments.length; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  payments = await listPayments(connection, owner)
}
const payment = payments.find((p) => p.signature === paid.body.signature)
check(!!payment && payment.amountUsdc === 2_000_000n, `payment detected on chain: ${payment ? formatUsd(payment.amountUsdc) : 'none'}`)
if (!payment) process.exit(1)

const rule = { stashBps: 2000, basket: [{ mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', weightBps: 10_000 }] }
console.log(`  rule saved: ${await sign(await buildRuleTransaction(connection, owner, rule))}`)
check(JSON.stringify(await fetchRule(connection, owner)) === JSON.stringify(rule), 'rule reads back from chain')

const built = await buildStashTransaction(connection, owner, payment, rule)
console.log(`  stashed ${formatUsd(built.stashUsdc)}: ${await sign(built)}`)
const stashAcct = await stashAccountAddress(owner)
check((await tokenBalance(connection, stashAcct)) === 400_000n, 'stash account holds $0.40')
check((await tokenBalance(connection, usdcAccount(owner))) === 1_600_000n, 'wallet keeps $1.60')
check((await stashedSignatures(connection, owner, [payment.signature])).has(payment.signature), 'receipt found for the payment')

try {
  await sign(await buildStashTransaction(connection, owner, payment, rule))
  check(false, 'second stash of the same payment refused')
} catch (e) {
  check(true, `second stash of the same payment refused (${String(e).slice(0, 80)})`)
}

console.log(`  moved back: ${await sign(await buildWithdrawTransaction(connection, owner, 400_000n))}`)
check((await tokenBalance(connection, usdcAccount(owner))) === 2_000_000n, 'wallet back to $2.00')

const again = (await listPayments(connection, owner)).filter((p) => p.signature !== payment.signature)
check(again.length === 0, 'its own stash and move-back are not counted as payments')

if (failures) {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nPhone and web client: all devnet checks passed.')
