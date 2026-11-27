import {
  STOCKS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  associatedTokenAddress,
  treasuryFeeAccount,
} from "@stash/core";

/**
 * Accounts holding test balances we wrote with cheatcodes. refreshRoute() must
 * never reset these: on mainnet they're empty or don't exist.
 */
export function protectedAccounts(owner: string, treasury: string): Set<string> {
  const keep = new Set<string>([
    owner,
    treasury,
    associatedTokenAddress(owner, USDC_MINT, TOKEN_PROGRAM_ID),
    // The treasury's USDC account, for fees on sales.
    associatedTokenAddress(treasury, USDC_MINT, TOKEN_PROGRAM_ID),
  ]);
  for (const s of STOCKS) {
    keep.add(associatedTokenAddress(owner, s.mint, TOKEN_2022_PROGRAM_ID));
    keep.add(treasuryFeeAccount(treasury, s.mint));
  }
  return keep;
}
