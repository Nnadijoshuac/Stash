/**
 * The only tokens Stash will ever buy.
 *
 * Anyone can mint a Token-2022 token called "NVIDIA xStock". On 25 Nov 2026 a
 * Jupiter search for NVDAx returned the real mint and several look-alikes
 * ("NVDAXa", mints ending in "pump") with thousands of dollars of liquidity
 * behind them. So a stock is never resolved from its symbol or name. It is
 * resolved from this list, and a mint that is not on it is refused.
 *
 * Every entry was read from Jupiter's verified token list (verified, tagged
 * xstocks, Token-2022, 8 decimals) on 25 Nov 2026.
 */

export interface Stock {
  /** Ticker as xStocks publish it, for display only. Never used for lookup. */
  symbol: string;
  name: string;
  /** What the stock tracks, in words a non-crypto user understands. */
  tracks: string;
  mint: string;
  decimals: number;
}

export const STOCKS: readonly Stock[] = Object.freeze([
  { symbol: "SPYx", name: "SP500 xStock", tracks: "S&P 500", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8 },
  { symbol: "QQQx", name: "Nasdaq xStock", tracks: "Nasdaq 100", mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", decimals: 8 },
  { symbol: "NVDAx", name: "NVIDIA xStock", tracks: "Nvidia", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8 },
  { symbol: "TSLAx", name: "Tesla xStock", tracks: "Tesla", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8 },
  { symbol: "AAPLx", name: "Apple xStock", tracks: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8 },
]);

const BY_MINT = new Map(STOCKS.map((s) => [s.mint, s]));

export function isAllowlisted(mint: string): boolean {
  return BY_MINT.has(mint);
}

/** Returns the stock for a mint, or throws if Stash does not buy it. */
export function stockForMint(mint: string): Stock {
  const stock = BY_MINT.get(mint);
  if (!stock) {
    throw new Error(`Refusing ${mint}: it is not on Stash's allowlist of verified xStocks.`);
  }
  return stock;
}
