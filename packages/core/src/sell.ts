/**
 * Selling a stock back to USDC: one stock, one Jupiter route, one transaction.
 * Stash's fee comes out in USDC.
 */
import { Connection, PublicKey, TransactionInstruction, AddressLookupTableAccount } from "@solana/web3.js";
import { stockForMint } from "./allowlist";
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from "./ata";
import { FULL_WEIGHT_BPS, USDC_MINT } from "./constants";
import { packBasket, type Packed } from "./basket";
import { quoteSell, swapInstructions, toInstruction, type JupiterQuote } from "./jupiter";

/** Where the fee on a sale goes. */
export function treasuryUsdcFeeAccount(treasury: string): string {
  return associatedTokenAddress(treasury, USDC_MINT, TOKEN_PROGRAM_ID);
}

/** How much of a holding to sell for a share in basis points. 10,000 sells all of it, no dust. */
export function sellAmount(holding: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps <= 0 || bps > FULL_WEIGHT_BPS) {
    throw new Error("Choose how much to sell: more than 0% and at most 100%.");
  }
  if (holding <= 0n) throw new Error("You do not hold any of this stock.");
  const amount = bps === FULL_WEIGHT_BPS ? holding : (holding * BigInt(bps)) / BigInt(FULL_WEIGHT_BPS);
  if (amount <= 0n) throw new Error("That is less than the smallest unit of this stock. Sell a larger share.");
  return amount;
}

export interface BuildSellInput {
  connection: Connection;
  owner: string;
  treasury: string;
  mint: string;
  /** Stock base units to sell. */
  amount: bigint;
  platformFeeBps?: number;
}

export interface BuiltSell extends Packed {
  quote: JupiterQuote;
  routeAccounts: string[];
}

export async function buildSell(input: BuildSellInput): Promise<BuiltSell> {
  stockForMint(input.mint);
  const quote = await quoteSell({
    inputMint: input.mint,
    amount: input.amount,
    ...(input.platformFeeBps !== undefined ? { platformFeeBps: input.platformFeeBps } : {}),
  });
  const ixs = await swapInstructions(quote, input.owner, treasuryUsdcFeeAccount(input.treasury));
  if (ixs.otherInstructions?.length || ixs.cleanupInstruction) {
    throw new Error("Jupiter returned extra instructions for this sale that Stash does not place yet.");
  }
  const lookupTables = (
    await Promise.all(
      ixs.addressLookupTableAddresses.map((a) => input.connection.getAddressLookupTable(new PublicKey(a))),
    )
  )
    .map((r) => r.value)
    .filter((t): t is AddressLookupTableAccount => t !== null);
  const { blockhash } = await input.connection.getLatestBlockhash("confirmed");
  const packed = packBasket({
    owner: new PublicKey(input.owner),
    setup: [ixs.setupInstructions.map(toInstruction) as TransactionInstruction[]],
    swaps: [toInstruction(ixs.swapInstruction)],
    lookupTables,
    recentBlockhash: blockhash,
  });
  return { ...packed, quote, routeAccounts: ixs.swapInstruction.accounts.map((a) => a.pubkey) };
}
