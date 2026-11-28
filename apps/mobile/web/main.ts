/**
 * Stash on devnet, in the browser. Same program, same transactions as the
 * Android app (it imports lib/stash.ts and lib/payments.ts).
 *
 * Wallets come through Reown AppKit, so whatever the visitor has works:
 * Phantom, Solflare, Backpack in the browser, or any wallet on their phone
 * over WalletConnect.
 *
 * Built into site/app by tools/build-demo.mjs.
 */
import { Connection, PublicKey, VersionedTransaction, clusterApiUrl } from '@solana/web3.js'
import { createAppKit } from '@reown/appkit'
import { solanaDevnet as devnetChain, type AppKitNetwork } from '@reown/appkit/networks'
import { SolanaAdapter } from '@reown/appkit-adapter-solana'
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

// Public by design: a Reown project id ships in every page that uses it.
const PROJECT_ID = process.env.REOWN_PROJECT_ID ?? ''

type SolanaProvider = { signTransaction<T extends VersionedTransaction>(tx: T): Promise<T> }

// Cast: two copies of viem's chain types meet here (types only).
const solanaDevnet = devnetChain as AppKitNetwork

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const modal = createAppKit({
  adapters: [new SolanaAdapter()],
  networks: [solanaDevnet] as [AppKitNetwork],
  defaultNetwork: solanaDevnet,
  projectId: PROJECT_ID,
  metadata: {
    name: 'Stash',
    description: 'Invest a slice of every payment',
    url: location.origin,
    icons: [`${location.origin}/brand/stash-splat-192.png`],
  },
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false },
  // Phantom, Solflare, Backpack first; any other wallet is one search away.
  featuredWalletIds: [
    'a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393',
    '1ca0bdd4747578705b1939af023d120677c64fe6ca76add81fda36e350605e79',
    '2bd8c14e035c2d48f184aaa168559e86b0e3433228d3c4075900a221785019b0',
  ],
  themeMode: 'light',
  themeVariables: { '--w3m-accent': '#ff5a1f', '--w3m-font-family': 'Inter, system-ui, sans-serif', '--w3m-border-radius-master': '2px' },
})

let provider: SolanaProvider | null = null
let owner: PublicKey | null = null
let rule: Rule | null = null
let draft: Rule = { stashBps: 2000, basket: [{ mint: STOCKS[0].mint, weightBps: 10_000 }] }
let payments: Payment[] = []
let stashed = new Set<string>()

function say(text: string, ok = true, sig?: string) {
  const el = $('message')
  el.className = ok ? 'ok' : 'bad'
  el.textContent = text
  if (sig) {
    const a = document.createElement('a')
    a.href = explorer(sig)
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = 'View'
    el.append(' ', a)
  }
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/reject|denied|cancel/i.test(m)) return 'Cancelled in your wallet.'
  return m
}

async function send(tx: VersionedTransaction, blockhash: string, lastValidBlockHeight: number): Promise<string> {
  if (!provider) throw new Error('Connect a wallet first.')
  const signed = await provider.signTransaction(tx)
  const sig = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 5 })
  const result = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  if (result.value.err) throw new Error(`Solana refused it: ${JSON.stringify(result.value.err)}`)
  return sig
}

async function busy(button: HTMLButtonElement, work: () => Promise<void>) {
  const label = button.textContent
  button.disabled = true
  button.textContent = 'Confirm in your wallet…'
  try {
    await work()
  } catch (e) {
    say(errorText(e), false)
  } finally {
    button.disabled = false
    button.textContent = label
  }
}

function chip(text: string, on: boolean, onClick: () => void) {
  const b = document.createElement('button')
  b.className = on ? 'chip on' : 'chip'
  b.textContent = text
  b.onclick = onClick
  return b
}

function renderRule() {
  const shares = $('shares')
  shares.replaceChildren(
    ...[1000, 2000, 3000, 5000].map((bps) =>
      chip(`${bps / 100}%`, draft.stashBps === bps, () => {
        draft = { ...draft, stashBps: bps }
        renderRule()
      }),
    ),
  )
  const picked = draft.basket.map((b) => b.mint)
  $('stocks').replaceChildren(
    ...STOCKS.map((s) =>
      chip(s.tracks, picked.includes(s.mint), () => {
        // One or two stocks: with the receipt, that's what fits in one mainnet transaction.
        const next = picked.includes(s.mint)
          ? picked.length > 1 ? picked.filter((m) => m !== s.mint) : picked
          : [...picked, s.mint].slice(-2)
        draft = { ...draft, basket: next.map((mint) => ({ mint, weightBps: 10_000 / next.length })) }
        renderRule()
      }),
    ),
  )
  const same = rule !== null && JSON.stringify(rule) === JSON.stringify(draft)
  const save = $<HTMLButtonElement>('save')
  save.hidden = same
  save.textContent = rule ? 'Update rule' : 'Save rule'
}

function renderPayments() {
  const box = $('payments')
  if (payments.length === 0) {
    box.innerHTML = '<p class="empty">No payments yet.</p>'
    return
  }
  box.replaceChildren(
    ...payments.map((p) => {
      const row = document.createElement('div')
      row.className = 'row'
      const when = p.blockTime ? new Date(p.blockTime * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Just now'
      row.innerHTML = `<div><strong>${formatUsd(p.amountUsdc)}</strong><a href="${explorer(p.signature)}" target="_blank" rel="noopener">${when}</a></div>`
      if (stashed.has(p.signature)) {
        const s = document.createElement('span')
        s.className = 'done'
        s.textContent = 'Stashed'
        row.append(s)
      } else if (rule) {
        const b = document.createElement('button')
        b.className = 'primary'
        b.textContent = `Stash ${formatUsd(ruleAmount(p.amountUsdc, rule.stashBps))}`
        b.onclick = () =>
          busy(b, async () => {
            const built = await buildStashTransaction(connection, owner!, p, rule!)
            const sig = await send(built.transaction, built.blockhash, built.lastValidBlockHeight)
            say(`Stashed ${formatUsd(built.stashUsdc)}.`, true, sig)
            await refresh()
          })
        row.append(b)
      }
      return row
    }),
  )
}

async function refresh() {
  if (!owner) return
  const me = owner
  const [r, inWallet, saved, list] = await Promise.all([
    fetchRule(connection, me),
    tokenBalance(connection, usdcAccount(me)),
    stashAccountAddress(me).then((a) => tokenBalance(connection, a)),
    listPayments(connection, me),
  ])
  if (owner !== me) return
  rule = r
  if (r) draft = r
  payments = list
  stashed = await stashedSignatures(connection, me, list.map((p) => p.signature))
  $('usdc').textContent = formatUsd(inWallet)
  $('saved').textContent = formatUsd(saved)
  const back = $<HTMLButtonElement>('withdraw')
  back.hidden = saved === 0n
  back.textContent = `Move ${formatUsd(saved)} back to my wallet`
  back.onclick = () =>
    busy(back, async () => {
      const built = await buildWithdrawTransaction(connection, me, saved)
      const sig = await send(built.transaction, built.blockhash, built.lastValidBlockHeight)
      say(`Moved ${formatUsd(saved)} back.`, true, sig)
      await refresh()
    })
  renderRule()
  renderPayments()
}

function show(address: string | undefined) {
  const next = address ? new PublicKey(address) : null
  if (next?.toBase58() === owner?.toBase58()) return
  owner = next
  rule = null
  payments = []
  $('welcome').hidden = !!owner
  $('app').hidden = !owner
  const acct = $<HTMLButtonElement>('account')
  acct.hidden = !owner
  if (owner) {
    const a = owner.toBase58()
    acct.textContent = `${a.slice(0, 4)}…${a.slice(-4)}`
    say('')
    renderRule()
    renderPayments()
    void refresh().catch((e) => say(errorText(e), false))
  }
}

modal.subscribeAccount((state) => show(state.isConnected ? state.address : undefined), 'solana')
modal.subscribeProviders((state) => {
  provider = (state['solana'] as SolanaProvider | undefined) ?? null
})

$<HTMLButtonElement>('connect').onclick = () => void modal.open()
$<HTMLButtonElement>('account').onclick = () => void modal.open({ view: 'Account' })

$<HTMLButtonElement>('save').onclick = (ev) =>
  busy(ev.currentTarget as HTMLButtonElement, async () => {
    const built = await buildRuleTransaction(connection, owner!, draft)
    const sig = await send(built.transaction, built.blockhash, built.lastValidBlockHeight)
    say('Rule saved.', true, sig)
    await refresh()
  })

$<HTMLButtonElement>('pay').onclick = (ev) => {
  const b = ev.currentTarget as HTMLButtonElement
  const label = b.textContent
  b.disabled = true
  b.textContent = 'Sending…'
  void (async () => {
    try {
      const res = await fetch('/api/pay', { method: 'POST', body: JSON.stringify({ owner: owner!.toBase58() }) })
      const data = (await res.json()) as { signature?: string; error?: string; usdc?: string }
      if (!res.ok || !data.signature) throw new Error(data.error ?? `The test payer answered ${res.status}.`)
      say(`You were paid ${data.usdc}.`, true, data.signature)
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2500))
        await refresh()
        if (payments.some((p) => p.signature === data.signature)) break
      }
    } catch (e) {
      say(errorText(e), false)
    } finally {
      b.disabled = false
      b.textContent = label
    }
  })()
}

setInterval(() => void refresh().catch(() => {}), 15_000)
