/**
 * Dollar prices for allowlisted stocks, so the app can show what a stash is
 * worth, not only how many tokens it holds.
 *
 * Jupiter's price API returns a USD price per token. xStocks are Token-2022
 * mints and some carry a scaled-UI multiplier (for splits and dividends), so a
 * token is not always exactly one share; valuing holdings as tokens x price
 * per token is correct either way. Prices are display-only: no money decision
 * reads them, quotes do.
 */
import { stockForMint } from "./allowlist";

const PRICE_API = "https://lite-api.jup.ag/price/v3";
const CACHE_MS = 30_000;

export interface StockPrice {
  usdPrice: number;
  /** Percent, e.g. -3.68 for down 3.68% over 24 hours. */
  change24h: number | null;
}

let cache: { at: number; prices: Record<string, StockPrice> } | null = null;

/** USD prices for the given allowlisted mints, cached for 30 seconds. */
export async function getPrices(mints: string[]): Promise<Record<string, StockPrice>> {
  mints.forEach((m) => stockForMint(m));
  if (cache && Date.now() - cache.at < CACHE_MS && mints.every((m) => m in cache!.prices)) {
    return cache.prices;
  }
  const res = await fetch(`${PRICE_API}?ids=${mints.join(",")}`);
  if (!res.ok) throw new Error(`Price service returned ${res.status}.`);
  const body = (await res.json()) as Record<string, { usdPrice?: number; priceChange24h?: number } | null>;
  const prices: Record<string, StockPrice> = {};
  for (const m of mints) {
    const p = body[m];
    if (p && typeof p.usdPrice === "number") prices[m] = { usdPrice: p.usdPrice, change24h: p.priceChange24h ?? null };
  }
  cache = { at: Date.now(), prices };
  return prices;
}

/** Dollar value of a token amount in base units, given the stock's price. Display only. */
export function usdValue(amount: bigint, decimals: number, price: StockPrice | undefined): number | null {
  if (!price) return null;
  return (Number(amount) / 10 ** decimals) * price.usdPrice;
}
