import {
  STOCKS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  associatedTokenAddress,
  treasuryFeeAccount,
} from "@stash/core";

/**
 * The accounts that hold fake balances written by cheatcodes: the wallet, the
 * treasury, the wallet's USDC and stock accounts, and the treasury's fee
 * accounts. refreshRoute() must never re-pull these from mainnet, where they
 * are empty or do not exist.
 */
export function protectedAccounts(owner: string, treasury: string): Set<string> {
  const keep = new Set<string>([
    owner,
    treasury,
    associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM_ID),
    // Where Stash's fee on a sale lands.
    associatedTokenAddress(treasury, USDC_MINT, TOKEN_PROGRAM_ID),
  ]);
  for (const s of STOCKS) {
    keep.add(associatedTokenAddress(owner, s.mint, TOKEN_2022_PROGRAM_ID));
    keep.add(treasuryFeeAccount(treasury, s.mint));
  }
  return keep;
}
