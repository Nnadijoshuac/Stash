/**
 * The thin layer between Stash and Jupiter's swap API.
 *
 * Quotes are always fetched here, on the server side of the app, never taken
 * from the client: the client does not get to name a price. Every call also
 * re-checks the output mint against the allowlist, so a bug elsewhere cannot
 * route money into a look-alike token.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { stockForMint } from "./allowlist";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_ROUTE_MAX_ACCOUNTS,
  DEFAULT_SLIPPAGE_BPS,
  USDC_MINT,
} from "./constants";

/** Keyless public endpoint. Set JUPITER_API_URL to use a paid endpoint instead. */
export const JUPITER_API_URL =
  (typeof process !== "undefined" && process.env.JUPITER_API_URL) || "https://lite-api.jup.ag/swap/v1";

/** The parts of Jupiter's quote that Stash reads. The full object is kept to send back. */
export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  platformFee?: { amount: string; feeBps: number } | null;
  routePlan: { swapInfo: { label?: string; ammKey: string } }[];
  [key: string]: unknown;
}

interface JupiterInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

export interface JupiterSwapInstructions {
  computeBudgetInstructions: JupiterInstruction[];
  setupInstructions: JupiterInstruction[];
  swapInstruction: JupiterInstruction;
  cleanupInstruction?: JupiterInstruction | null;
  otherInstructions?: JupiterInstruction[];
  addressLookupTableAddresses: string[];
}

export interface QuoteParams {
  outputMint: string;
  /** USDC base units to spend on this leg. */
  usdc: bigint;
  platformFeeBps?: number;
  slippageBps?: number;
  maxAccounts?: number;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || "error" in body || "errorCode" in body) {
    throw new Error(`Jupiter refused: ${String(body.error ?? res.statusText)} (${String(body.errorCode ?? res.status)})`);
  }
  return body as T;
}

/** Quotes USDC into one allowlisted stock, with Stash's fee attached. */
export async function quoteLeg(params: QuoteParams): Promise<JupiterQuote> {
  stockForMint(params.outputMint);
  if (params.usdc <= 0n) throw new Error("A leg must spend more than zero.");
  const q = new URLSearchParams({
    inputMint: USDC_MINT,
    outputMint: params.outputMint,
    amount: params.usdc.toString(),
    swapMode: "ExactIn",
    slippageBps: String(params.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    platformFeeBps: String(params.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS),
    maxAccounts: String(params.maxAccounts ?? DEFAULT_ROUTE_MAX_ACCOUNTS),
  });
  const quote = await call<JupiterQuote>(`${JUPITER_API_URL}/quote?${q}`);
  if (quote.outputMint !== params.outputMint || quote.inputMint !== USDC_MINT) {
    throw new Error("Jupiter returned a quote for different tokens than were asked for.");
  }
  return quote;
}

export interface SellQuoteParams {
  inputMint: string;
  /** Stock base units to sell (xStocks have 8 decimals). */
  amount: bigint;
  platformFeeBps?: number;
  slippageBps?: number;
  maxAccounts?: number;
}

/**
 * Quotes selling an allowlisted stock back to USDC. On an ExactIn swap the
 * platform fee is taken in the output mint, so here it is paid in USDC and
 * the fee account is the treasury's USDC account.
 */
export async function quoteSell(params: SellQuoteParams): Promise<JupiterQuote> {
  stockForMint(params.inputMint);
  if (params.amount <= 0n) throw new Error("Choose an amount of the stock to sell.");
  const q = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: USDC_MINT,
    amount: params.amount.toString(),
    swapMode: "ExactIn",
    slippageBps: String(params.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    platformFeeBps: String(params.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS),
    maxAccounts: String(params.maxAccounts ?? DEFAULT_ROUTE_MAX_ACCOUNTS),
  });
  const quote = await call<JupiterQuote>(`${JUPITER_API_URL}/quote?${q}`);
  if (quote.inputMint !== params.inputMint || quote.outputMint !== USDC_MINT) {
    throw new Error("Jupiter returned a quote for different tokens than were asked for.");
  }
  return quote;
}

/**
 * Turns a quote into instructions for `owner`.
 *
 * `feeAccount` is the treasury's token account for the output stock. Jupiter
 * refuses a platform fee without one ("feeAccount is required for swap with
 * platformFee", ISSUES #2), and on an ExactIn swap the fee is paid in the
 * output mint, so each stock needs its own.
 */
export async function swapInstructions(
  quote: JupiterQuote,
  owner: string,
  feeAccount: string,
): Promise<JupiterSwapInstructions> {
  // One side of every swap Stash builds must be an allowlisted stock and the
  // other must be USDC: buying (USDC -> stock) or selling (stock -> USDC).
  const stockSide = quote.inputMint === USDC_MINT ? quote.outputMint : quote.inputMint;
  const otherSide = quote.inputMint === USDC_MINT ? quote.inputMint : quote.outputMint;
  stockForMint(stockSide);
  if (otherSide !== USDC_MINT) throw new Error("Stash only swaps between USDC and allowlisted stocks.");
  return call<JupiterSwapInstructions>(`${JUPITER_API_URL}/swap-instructions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: owner,
      feeAccount,
      wrapAndUnwrapSol: false,
    }),
  });
}

export function toInstruction(ix: JupiterInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, "base64"),
  });
}
