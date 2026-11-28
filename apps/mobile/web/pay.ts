/**
 * POST /api/pay on the live site: a test client pays the visitor $2 of
 * Circle's devnet USDC, plus 0.02 devnet SOL if they're short on fees. It
 * lets someone try Stash without collecting tokens from two faucets first.
 *
 * The payer's key is a devnet-only key in the DEMO_PAYER_SECRET environment
 * variable on Vercel (base58). It is never in the repo.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import bs58 from 'bs58'

const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const AMOUNT = 2_000_000n // $2
const LOW_SOL = 0.01 * LAMPORTS_PER_SOL
const TOP_UP = 0.02 * LAMPORTS_PER_SOL

type Req = { method?: string; body?: unknown }
type Res = { status(code: number): Res; json(body: unknown): void }

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
  const secret = process.env.DEMO_PAYER_SECRET
  if (!secret) return res.status(503).json({ error: 'The test payer is not set up.' })
  let owner: PublicKey
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as { owner?: string })
    owner = new PublicKey(String(body?.owner))
  } catch {
    return res.status(400).json({ error: 'Send {"owner": "<your wallet address>"}.' })
  }
  try {
    const payer = Keypair.fromSecretKey(bs58.decode(secret))
    const connection = new Connection(process.env.DEVNET_RPC ?? 'https://api.devnet.solana.com', 'confirmed')
    const from = getAssociatedTokenAddressSync(USDC, payer.publicKey)
    const to = getAssociatedTokenAddressSync(USDC, owner)
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, to, owner, USDC),
      createTransferCheckedInstruction(from, USDC, to, payer.publicKey, AMOUNT, 6),
    )
    if ((await connection.getBalance(owner, 'confirmed')) < LOW_SOL) {
      tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: owner, lamports: TOP_UP }))
    }
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = payer.publicKey
    tx.sign(payer)
    const signature = await connection.sendRawTransaction(tx.serialize())
    const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    if (result.value.err) throw new Error(JSON.stringify(result.value.err))
    return res.status(200).json({ signature, usdc: '$2.00' })
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    const empty = /insufficient|0x1\b/i.test(m)
    return res
      .status(empty ? 503 : 502)
      .json({ error: empty ? 'The test payer is out of devnet USDC. Use faucet.circle.com for now.' : `Devnet said: ${m.slice(0, 200)}` })
  }
}
