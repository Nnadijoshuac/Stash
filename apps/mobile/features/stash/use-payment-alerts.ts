/**
 * Puts a notification on the phone when a new payment lands, with the amount
 * the rule would stash. The app checks the chain every 15 seconds while it's
 * open. There's no push server yet, so a closed app hears about payments the
 * next time it's opened.
 */
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import type { Payment } from '@/lib/payments'
import { formatUsd, ruleAmount, type Rule } from '@/lib/stash'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export async function preparePaymentAlerts() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('payments', {
      name: 'Payments',
      importance: Notifications.AndroidImportance.HIGH,
    })
  }
  await Notifications.requestPermissionsAsync()
}

export function usePaymentAlerts(payments: Payment[] | undefined, stashed: Set<string> | undefined, rule: Rule | null) {
  // Payments that were already there when the app opened don't ring.
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!payments || !stashed) return
    if (seen.current === null) {
      seen.current = new Set(payments.map((p) => p.signature))
      return
    }
    for (const p of payments) {
      if (seen.current.has(p.signature)) continue
      seen.current.add(p.signature)
      if (stashed.has(p.signature)) continue
      const slice = rule ? ruleAmount(p.amountUsdc, rule.stashBps) : 0n
      void Notifications.scheduleNotificationAsync({
        content: {
          title: `You got paid ${formatUsd(p.amountUsdc)}`,
          body: slice > 0n ? `Stash ${formatUsd(slice)} of it? Open Stash to confirm.` : 'Set a rule in Stash to invest a slice.',
          data: { signature: p.signature },
        },
        trigger: Platform.OS === 'android' ? { channelId: 'payments' } : null,
      })
    }
  }, [payments, stashed, rule])
}
