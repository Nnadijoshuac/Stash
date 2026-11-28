function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  if (typeof error === 'string') return error
  return ''
}

/**
 * Wallet errors arrive as Java exception names (Mobile Wallet Adapter runs in
 * Android). A wallet that declines, or blocks the transaction itself, shows up
 * as a CancellationException, so say what that means instead.
 */
export function formatError(error: unknown) {
  const m = rawMessage(error).trim()
  if (/CancellationException|declin|reject|cancel/i.test(m)) {
    return 'Your wallet didn’t sign, so nothing was sent. If it blocked the transaction, set the wallet to devnet and try again.'
  }
  if (/insufficient|0x1\b/i.test(m)) return 'Not enough devnet SOL for the fee.'
  return m || 'Something went wrong. Try again.'
}
