/**
 * The only stocks Stash will buy.
 *
 * Anyone can mint a token called "NVIDIA xStock". Search Jupiter for NVDAx and
 * you get the real one plus look-alikes with real liquidity. So we never look a
 * stock up by name: these mints come from Jupiter's verified list, and
 * anything else is refused.
 */

export interface Stock {
  /** For display only. Never used to look a stock up. */
  symbol: string;
  name: string;
  /** What it tracks, in plain words. */
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

/** The stock for a mint. Throws if we don't buy it. */
export function stockForMint(mint: string): Stock {
  const stock = BY_MINT.get(mint);
  if (!stock) {
    throw new Error(`Refusing ${mint}: it is not on Stash's allowlist of verified xStocks.`);
  }
  return stock;
}
