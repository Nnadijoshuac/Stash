import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { colors, font } from '@/constants/theme'
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
import { preparePaymentAlerts, usePaymentAlerts } from '@/features/stash/use-payment-alerts'
import { formatError } from '@/utils/format-error'
import { ellipsify } from '@/utils/ellipsify'

const SHARES = [1000, 2000, 3000, 5000]
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`

export function StashScreen() {
  const { account, connect } = useMobileWallet()
  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          <Text style={s.wordmark}>Stash</Text>
          <Text style={s.lede}>Invest a slice of every payment.</Text>
          <Text style={s.network}>Solana devnet</Text>
        </View>
        {account ? (
          <Connected owner={account.address} />
        ) : (
          <View style={s.section}>
            <Text style={s.body}>
              Connect a wallet to set your rule. When a payment lands, Stash tells you and one tap puts the slice aside.
            </Text>
            <Action title="Connect wallet" onPress={async () => void (await connect())} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Connected({ owner }: { owner: PublicKey }) {
  const { connection, disconnect, signAndSendTransactions } = useMobileWallet()
  const queryClient = useQueryClient()
  const key = owner.toBase58()
  const [message, setMessage] = useState<{ text: string; ok: boolean; sig?: string } | null>(null)

  useEffect(() => {
    void preparePaymentAlerts()
  }, [])

  const rule = useQuery({ queryKey: ['rule', key], queryFn: () => fetchRule(connection, owner) })
  const balances = useQuery({
    queryKey: ['balances', key],
    queryFn: async () => ({
      wallet: await tokenBalance(connection, usdcAccount(owner)),
      stashed: await tokenBalance(connection, await stashAccountAddress(owner)),
      sol: await connection.getBalance(owner, 'confirmed'),
    }),
    refetchInterval: 15_000,
  })
  const payments = useQuery({
    queryKey: ['payments', key],
    queryFn: async () => {
      const list = await listPayments(connection, owner)
      return { list, stashed: await stashedSignatures(connection, owner, list.map((p) => p.signature)) }
    },
    refetchInterval: 15_000,
  })
  usePaymentAlerts(payments.data?.list, payments.data?.stashed, rule.data ?? null)

  async function send(transaction: VersionedTransaction, minContextSlot: number, blockhash: string, lastValidBlockHeight: number) {
    const sig = await signAndSendTransactions(transaction, minContextSlot)
    const result = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    if (result.value.err) throw new Error(`Solana refused it: ${JSON.stringify(result.value.err)}`)
    return sig
  }

  async function refreshAll() {
    await queryClient.invalidateQueries()
  }

  async function saveRule(next: Rule) {
    const built = await buildRuleTransaction(connection, owner, next)
    const sig = await send(built.transaction, built.minContextSlot, built.blockhash, built.lastValidBlockHeight)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setMessage({ text: 'Rule saved on chain.', ok: true, sig })
    await refreshAll()
  }

  async function stash(p: Payment) {
    if (!rule.data) throw new Error('Save a rule first.')
    const built = await buildStashTransaction(connection, owner, p, rule.data)
    const sig = await send(built.transaction, built.minContextSlot, built.blockhash, built.lastValidBlockHeight)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setMessage({ text: `Stashed ${formatUsd(built.stashUsdc)}. The receipt is on chain.`, ok: true, sig })
    await refreshAll()
  }

  async function withdraw(amount: bigint) {
    const built = await buildWithdrawTransaction(connection, owner, amount)
    const sig = await send(built.transaction, built.minContextSlot, built.blockhash, built.lastValidBlockHeight)
    setMessage({ text: `Moved ${formatUsd(amount)} back to your wallet.`, ok: true, sig })
    await refreshAll()
  }

  const fail = (e: unknown) => setMessage({ text: formatError(e), ok: false })

  return (
    <View style={s.stack}>
      <View style={s.section}>
        <Text style={s.label}>Wallet {ellipsify(key, 4)}</Text>
        <View style={s.figures}>
          <Figure label="USDC" value={balances.data ? formatUsd(balances.data.wallet) : '…'} />
          <Figure label="Stashed" value={balances.data ? formatUsd(balances.data.stashed) : '…'} />
        </View>
        {balances.data && balances.data.sol < 5_000_000 ? (
          <Text style={s.note}>
            This wallet needs a little devnet SOL for fees.{' '}
            <Text style={s.link} onPress={() => Linking.openURL(`https://faucet.solana.com/?walletAddress=${key}`)}>
              Get some
            </Text>
          </Text>
        ) : null}
      </View>

      {message ? (
        <Text style={[s.note, s.message, { color: message.ok ? colors.good : colors.bad }]}>
          {message.text}
          {message.sig ? (
            <Text style={s.link} onPress={() => Linking.openURL(explorer(message.sig!))}>
              {'  '}View on explorer
            </Text>
          ) : null}
        </Text>
      ) : null}

      <RuleEditor saved={rule.data ?? null} loading={rule.isLoading} onSave={(r) => saveRule(r).catch(fail)} />

      <View style={s.section}>
        <Text style={s.heading}>Payments</Text>
        {payments.isLoading ? <ActivityIndicator color={colors.navy} /> : null}
        {payments.data && payments.data.list.length === 0 ? (
          <Text style={s.note}>
            No USDC payments yet. Send devnet USDC to this wallet from{' '}
            <Text style={s.link} onPress={() => Linking.openURL('https://faucet.circle.com')}>
              faucet.circle.com
            </Text>{' '}
            or another wallet. It shows up here within 15 seconds.
          </Text>
        ) : null}
        {payments.data?.list.map((p) => (
          <PaymentRow
            key={p.signature}
            payment={p}
            stashed={payments.data!.stashed.has(p.signature)}
            rule={rule.data ?? null}
            onStash={() => stash(p).catch(fail)}
          />
        ))}
      </View>

      <View style={s.section}>
        <Text style={s.note}>
          Devnet has no tokenized stocks, so here the slice moves into a second USDC account that only your wallet
          controls, and the program writes the receipt. On mainnet the same tap buys the stocks in your rule.
        </Text>
        {balances.data && balances.data.stashed > 0n ? (
          <Text style={s.link} onPress={() => withdraw(balances.data!.stashed).catch(fail)}>
            Move {formatUsd(balances.data.stashed)} back to my wallet
          </Text>
        ) : null}
        <Text style={s.link} onPress={() => void disconnect()}>
          Disconnect
        </Text>
      </View>
    </View>
  )
}

function RuleEditor({ saved, loading, onSave }: { saved: Rule | null; loading: boolean; onSave: (r: Rule) => Promise<void> }) {
  const [share, setShare] = useState(2000)
  const [picked, setPicked] = useState<string[]>([STOCKS[0].mint])

  useEffect(() => {
    if (!saved) return
    setShare(saved.stashBps)
    setPicked(saved.basket.map((b) => b.mint))
  }, [saved])

  const next: Rule = {
    stashBps: share,
    basket: picked.map((mint) => ({ mint, weightBps: 10_000 / picked.length })),
  }
  const unchanged =
    saved !== null &&
    saved.stashBps === next.stashBps &&
    saved.basket.length === next.basket.length &&
    saved.basket.every((b, i) => b.mint === next.basket[i].mint && b.weightBps === next.basket[i].weightBps)

  function toggle(mint: string) {
    setPicked((cur) => {
      if (cur.includes(mint)) return cur.length > 1 ? cur.filter((m) => m !== mint) : cur
      // Two stocks at most: that's what fits in one transaction with the receipt.
      return cur.length < 2 ? [...cur, mint] : [cur[1], mint]
    })
  }

  return (
    <View style={s.section}>
      <Text style={s.heading}>Your rule</Text>
      <Text style={s.body}>Stash this much of every payment</Text>
      <View style={s.chips}>
        {SHARES.map((bps) => (
          <Chip key={bps} label={`${bps / 100}%`} on={share === bps} onPress={() => setShare(bps)} />
        ))}
      </View>
      <Text style={s.body}>Into one or two of these</Text>
      <View style={s.chips}>
        {STOCKS.map((st) => (
          <Chip key={st.mint} label={st.tracks} on={picked.includes(st.mint)} onPress={() => toggle(st.mint)} />
        ))}
      </View>
      {picked.length === 2 ? <Text style={s.note}>Split evenly between the two.</Text> : null}
      {loading ? null : unchanged ? (
        <Text style={[s.note, { color: colors.good }]}>Saved on chain.</Text>
      ) : (
        <Action title={saved ? 'Update rule' : 'Save rule'} onPress={() => onSave(next)} />
      )}
    </View>
  )
}

function PaymentRow({
  payment,
  stashed,
  rule,
  onStash,
}: {
  payment: Payment
  stashed: boolean
  rule: Rule | null
  onStash: () => Promise<void>
}) {
  const slice = rule ? ruleAmount(payment.amountUsdc, rule.stashBps) : 0n
  const when = payment.blockTime ? new Date(payment.blockTime * 1000).toLocaleString() : ''
  return (
    <View style={s.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.amount}>{formatUsd(payment.amountUsdc)}</Text>
        <Text style={s.meta} onPress={() => Linking.openURL(explorer(payment.signature))}>
          {payment.from ? `from ${ellipsify(payment.from, 4)}` : 'received'} · {when}
        </Text>
      </View>
      {stashed ? (
        <Text style={[s.meta, { color: colors.good }]}>Stashed</Text>
      ) : rule && slice > 0n ? (
        <Action small title={`Stash ${formatUsd(slice)}`} onPress={onStash} />
      ) : (
        <Text style={s.meta}>Set a rule</Text>
      )}
    </View>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={s.meta}>{label}</Text>
      <Text style={s.figure}>{value}</Text>
    </View>
  )
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      style={[s.chip, on && s.chipOn]}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  )
}

function Action({ title, onPress, small }: { title: string; onPress: () => Promise<void>; small?: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <Pressable
      disabled={busy}
      onPress={async () => {
        setBusy(true)
        try {
          await onPress()
        } finally {
          setBusy(false)
        }
      }}
      style={({ pressed }) => [s.button, small && s.buttonSmall, pressed && { backgroundColor: colors.orangePress }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>{title}</Text>}
    </Pressable>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingBottom: 48 },
  hero: { backgroundColor: colors.navy, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 32, gap: 6 },
  wordmark: { fontFamily: font.bold, fontSize: 40, letterSpacing: -1.2, color: colors.onNavy },
  lede: { fontFamily: font.medium, fontSize: 18, color: colors.onNavy },
  network: { fontFamily: font.regular, fontSize: 13, color: colors.onNavyMuted, marginTop: 6 },
  stack: { gap: 4 },
  section: { paddingHorizontal: 24, paddingTop: 28, gap: 12 },
  heading: { fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  label: { fontFamily: font.medium, fontSize: 13, color: colors.muted },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  note: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
  message: { paddingHorizontal: 24, paddingTop: 20 },
  link: { fontFamily: font.medium, fontSize: 14, color: colors.orange },
  figures: { flexDirection: 'row', gap: 40 },
  figure: { fontFamily: font.semibold, fontSize: 28, letterSpacing: -0.6, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: '#e9edf3' },
  chipOn: { backgroundColor: colors.navy },
  chipText: { fontFamily: font.medium, fontSize: 14, color: colors.ink },
  chipTextOn: { color: colors.onNavy },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  amount: { fontFamily: font.semibold, fontSize: 17, color: colors.ink },
  meta: { fontFamily: font.regular, fontSize: 13, color: colors.muted },
  button: {
    backgroundColor: colors.orange,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonSmall: { paddingVertical: 9, paddingHorizontal: 14, minHeight: 38 },
  buttonText: { fontFamily: font.semibold, fontSize: 15, color: '#fff' },
})
