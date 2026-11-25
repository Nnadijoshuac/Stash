/**
 * Turns a payment and the user's rule into the exact USDC amount each stock
 * receives. This is the only file that decides how much money goes where, so
 * it is pure, uses integer base units throughout (never floats), and is
 * covered by tests.
 *
 * The invariant that matters: the legs always add up to exactly the amount
 * the rule says to stash. Not a base unit more, not a base unit less.
 */
import { FULL_WEIGHT_BPS, MAX_BASKET_LEGS, MIN_LEG_USDC, USDC_DECIMALS } from "./constants";
import { stockForMint } from "./allowlist";

export interface BasketWeight {
  mint: string;
  /** Share of the stashed amount for this stock, in basis points. */
  weightBps: number;
}

export interface StashRule {
  /** Share of each payment to stash, in basis points. 2,000 is 20%. */
  stashBps: number;
  basket: BasketWeight[];
}

export interface Leg {
  mint: string;
  symbol: string;
  /** USDC base units going into this stock. */
  usdc: bigint;
}

export interface Allocation {
  paymentUsdc: bigint;
  stashUsdc: bigint;
  legs: Leg[];
}

/** Throws with a sentence a user could act on if the rule cannot be used. */
export function validateRule(rule: StashRule): void {
  const { stashBps, basket } = rule;
  if (!Number.isInteger(stashBps) || stashBps <= 0 || stashBps > FULL_WEIGHT_BPS) {
    throw new Error("Choose how much of each payment to stash: more than 0% and at most 100%.");
  }
  if (basket.length === 0) {
    throw new Error("Pick at least one stock.");
  }
  if (basket.length > MAX_BASKET_LEGS) {
    throw new Error(`A basket can hold at most ${MAX_BASKET_LEGS} stocks, so it fits in one transaction.`);
  }
  const seen = new Set<string>();
  let total = 0;
  for (const { mint, weightBps } of basket) {
    stockForMint(mint); // throws for anything off the allowlist
    if (seen.has(mint)) throw new Error("Each stock can appear in the basket only once.");
    seen.add(mint);
    if (!Number.isInteger(weightBps) || weightBps <= 0) {
      throw new Error("Every stock in the basket needs a share above 0%.");
    }
    total += weightBps;
  }
  if (total !== FULL_WEIGHT_BPS) {
    throw new Error(`The basket's shares add up to ${total / 100}%. They must add up to 100%.`);
  }
}

/**
 * Splits a payment according to the rule.
 *
 * Each leg gets the floor of its share. The few base units left over by
 * rounding go to the heaviest leg (the first one on a tie), so the result is
 * deterministic and the total is exact.
 */
export function allocate(paymentUsdc: bigint, rule: StashRule): Allocation {
  validateRule(rule);
  if (paymentUsdc <= 0n) throw new Error("There is no payment to stash from.");

  const full = BigInt(FULL_WEIGHT_BPS);
  const stashUsdc = (paymentUsdc * BigInt(rule.stashBps)) / full;

  const legs: Leg[] = rule.basket.map(({ mint, weightBps }) => ({
    mint,
    symbol: stockForMint(mint).symbol,
    usdc: (stashUsdc * BigInt(weightBps)) / full,
  }));

  const assigned = legs.reduce((sum, leg) => sum + leg.usdc, 0n);
  const heaviest = rule.basket.reduce(
    (best, w, i) => (w.weightBps > rule.basket[best]!.weightBps ? i : best),
    0,
  );
  legs[heaviest]!.usdc += stashUsdc - assigned;

  const smallest = legs.reduce((min, leg) => (leg.usdc < min.usdc ? leg : min));
  if (smallest.usdc < MIN_LEG_USDC) {
    throw new Error(
      `This payment is too small to stash: ${smallest.symbol} would get ${formatUsdc(smallest.usdc)}, ` +
        `and the smallest purchase is ${formatUsdc(MIN_LEG_USDC)}.`,
    );
  }

  return { paymentUsdc, stashUsdc, legs };
}

/** "$12.34" from base units, without floating point. */
export function formatUsdc(baseUnits: bigint): string {
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const whole = abs / scale;
  const cents = (abs % scale) / 10n ** BigInt(USDC_DECIMALS - 2);
  return `${negative ? "-" : ""}$${whole}.${cents.toString().padStart(2, "0")}`;
}
