/**
 * Stash on devnet, in the browser. Same program, same transactions as the
 * Android app (it imports lib/stash.ts and lib/payments.ts), signed by any
 * Wallet Standard wallet: Phantom, Solflare, Backpack.
 *
 * Built into site/app by tools/build-site.sh.
 */
import { Connection, PublicKey, VersionedTransaction, clusterApiUrl } from '@solana/web3.js'
import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { listPayments, type Payment } from '@/lib/payments'
import {
  STOCKS,
  buildRuleTransaction,
  buildStashTransaction,
  buildWithdrawTransaction,
  fetchRule,
  formatUsd,
  ruleAmount,
  stashAccountAddress,
  stashedSignatures,
  tokenBalance,
  usdcAccount,
  type Rule,
} from '@/lib/stash'

const CHAIN = 'solana:devnet'
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

type SignFeature = {
  signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>
}
type ConnectFeature = { connect(): Promise<{ accounts: readonly WalletAccount[] }> }

let wallet: Wallet | null = null
let account: WalletAccount | null = null
let owner: PublicKey | null = null
let rule: Rule | null = null
let draft: Rule = { stashBps: 2000, basket: [{ mint: STOCKS[0].mint, weightBps: 10_000 }] }
let payments: Payment[] = []
let stashed = new Set<string>()

function usable(w: Wallet): boolean {
  return 'standard:connect' in w.features && 'solana:signTransaction' in w.features && w.chains.some((c) => c.startsWith('solana:'))
}

function say(text: string, ok = true, sig?: string) {
  const el = $('message')
  el.className = ok ? 'ok' : 'bad'
  el.innerHTML = ''
  el.append(text)
  if (sig) {
    const a = document.createElement('a')
    a.href = explorer(sig)
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = 'View on explorer'
    el.append(' ', a)
  }
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/reject|denied|cancel/i.test(m)) return 'You declined in your wallet. Nothing was sent.'
  return m
}

async function send(tx: VersionedTransaction, blockhash: string, lastValidBlockHeight: number): Promise<string> {
  if (!wallet || !account) throw new Error('Connect a wallet first.')
  const feature = wallet.features['solana:signTransaction'] as SignFeature
  const [{ signedTransaction }] = await feature.signTransaction({ account, transaction: tx.serialize(), chain: CHAIN })
  const sig = await connection.sendRawTransaction(signedTransaction, { maxRetries: 5 })
  const result = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  if (result.value.err) throw new Error(`Solana refused it: ${JSON.stringify(result.value.err)}`)
  return sig
}

async function busy(button: HTMLButtonElement, work: () => Promise<void>) {
  const label = button.textContent
  button.disabled = true
  button.textContent = 'Working…'
  try {
    await work()
  } catch (e) {
    say(errorText(e), false)
  } finally {
    button.disabled = false
    button.textContent = label
  }
}

function renderWallets() {
  const list = getWallets().get().filter(usable)
  const box = $('wallets')
  box.innerHTML = ''
  if (list.length === 0) {
    box.innerHTML =
      '<p class="note">No Solana wallet found in this browser. Install <a href="https://phantom.com" target="_blank" rel="noopener">Phantom</a> or <a href="https://solflare.com" target="_blank" rel="noopener">Solflare</a>, set it to devnet, and reload.</p>'
    return
  }
  for (const w of list) {
    const b = document.createElement('button')
    b.className = 'primary'
    b.textContent = `Connect ${w.name}`
    b.onclick = () =>
      busy(b, async () => {
        const { accounts } = await (w.features['standard:connect'] as ConnectFeature).connect()
        if (!accounts[0]) throw new Error('The wallet returned no account.')
        wallet = w
        account = accounts[0]
        owner = new PublicKey(account.address)
        $('connect').hidden = true
        $('connected').hidden = false
        $('address').textContent = `${owner.toBase58().slice(0, 4)}…${owner.toBase58().slice(-4)}`
        say('Connected. Set your wallet to devnet if it isn’t already.')
        await refresh()
      })
    box.append(b)
  }
}

function renderRule() {
  const shares = $('shares')
  shares.innerHTML = ''
  for (const bps of [1000, 2000, 3000, 5000]) {
    const b = document.createElement('button')
    b.className = draft.stashBps === bps ? 'chip on' : 'chip'
    b.textContent = `${bps / 100}%`
    b.onclick = () => {
      draft = { ...draft, stashBps: bps }
      renderRule()
    }
    shares.append(b)
  }
  const stocks = $('stocks')
  stocks.innerHTML = ''
  const picked = draft.basket.map((b) => b.mint)
  for (const s of STOCKS) {
    const b = document.createElement('button')
    b.className = picked.includes(s.mint) ? 'chip on' : 'chip'
    b.textContent = s.tracks
    b.onclick = () => {
      let next = picked.includes(s.mint)
        ? picked.length > 1
          ? picked.filter((m) => m !== s.mint)
          : picked
        : picked.length < 2
          ? [...picked, s.mint]
          : [picked[1], s.mint]
      // Two stocks at most: with the receipt, that's what fits in one mainnet transaction.
      next = next.slice(0, 2)
      draft = { ...draft, basket: next.map((mint) => ({ mint, weightBps: 10_000 / next.length })) }
      renderRule()
    }
    stocks.append(b)
  }
  const same = rule !== null && JSON.stringify(rule) === JSON.stringify(draft)
  $('rule-state').textContent = same ? 'Saved on chain.' : rule ? 'Not saved yet.' : 'No rule on chain yet.'
  $<HTMLButtonElement>('save').hidden = same
}

function renderPayments() {
  const box = $('payments')
  box.innerHTML = ''
  if (payments.length === 0) {
    box.innerHTML = '<p class="note">No USDC payments yet. Press “Send me a test payment”, or send devnet USDC from another wallet.</p>'
    return
  }
  for (const p of payments) {
    const row = document.createElement('div')
    row.className = 'row'
    const when = p.blockTime ? new Date(p.blockTime * 1000).toLocaleString() : ''
    row.innerHTML = `<div><strong>${formatUsd(p.amountUsdc)}</strong><a class="meta" href="${explorer(p.signature)}" target="_blank" rel="noopener">${when}</a></div>`
    if (stashed.has(p.signature)) {
      const s = document.createElement('span')
      s.className = 'done'
      s.textContent = 'Stashed'
      row.append(s)
    } else if (rule) {
      const slice = ruleAmount(p.amountUsdc, rule.stashBps)
      const b = document.createElement('button')
      b.className = 'primary small'
      b.textContent = `Stash ${formatUsd(slice)}`
      b.onclick = () =>
        busy(b, async () => {
          const built = await buildStashTransaction(connection, owner!, p, rule!)
          const sig = await send(built.transaction, built.blockhash, built.lastValidBlockHeight)
          say(`Stashed ${formatUsd(built.stashUsdc)}. The receipt is on chain, so this payment can't be stashed again.`, true, sig)
          await refresh()
        })
      row.append(b)
    } else {
      const s = document.createElement('span')
      s.className = 'meta'
      s.textContent = 'Save a rule first'
      row.append(s)
    }
    box.append(row)
  }
}

async function refresh() {
  if (!owner) return
  const [r, wallet, saved, sol, list] = await Promise.all([
    fetchRule(connection, owner),
    tokenBalance(connection, usdcAccount(owner)),
    stashAccountAddress(owner).then((a) => tokenBalance(connection, a)),
    connection.getBalance(owner, 'confirmed'),
    listPayments(connection, owner),
  ])
  rule = r
  if (r) draft = r
  payments = list
  stashed = await stashedSignatures(connection, owner, list.map((p) => p.signature))
  $('usdc').textContent = formatUsd(wallet)
  $('saved').textContent = formatUsd(saved)
  $('sol').textContent = `${(sol / 1e9).toFixed(3)} SOL`
  const back = $<HTMLButtonElement>('withdraw')
  back.hidden = saved === 0n
  back.textContent = `Move ${formatUsd(saved)} back to my wallet`
  back.onclick = () =>
    busy(back, async () => {
      const built = await buildWithdrawTransaction(connection, owner!, saved)
      const sig = await send(built.transaction, built.blockhash, built.lastValidBlockHeight)
      say(`Moved ${formatUsd(saved)} back to your wallet.`, true, sig)
      await refresh()
    })
  renderRule()
  renderPayments()
}

$<HTMLButtonElement>('save').onclick = (ev) =>
  busy(ev.currentTarget as HTMLButtonElement, async () => {
    const built = await buildRuleTransaction(connection, owner!, draft)
    const sig = await send(built.transaction, built.blockhash, built.lastValidBlockHeight)
    say('Rule saved on chain.', true, sig)
    await refresh()
  })

$<HTMLButtonElement>('pay').onclick = (ev) =>
  busy(ev.currentTarget as HTMLButtonElement, async () => {
    const res = await fetch('/api/pay', { method: 'POST', body: JSON.stringify({ owner: owner!.toBase58() }) })
    const data = (await res.json()) as { signature?: string; error?: string; usdc?: string }
    if (!res.ok || !data.signature) throw new Error(data.error ?? `The test payer answered ${res.status}.`)
    say(`A test client paid you ${data.usdc}. It shows below in a few seconds.`, true, data.signature)
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      await refresh()
      if (payments.some((p) => p.signature === data.signature)) break
    }
  })

$<HTMLButtonElement>('refresh').onclick = (ev) => busy(ev.currentTarget as HTMLButtonElement, refresh)
$<HTMLButtonElement>('disconnect').onclick = () => location.reload()

renderWallets()
getWallets().on('register', renderWallets)
setInterval(() => void refresh().catch(() => {}), 15_000)
