/**
 * Associated token account addresses, derived without pulling in the whole
 * SPL token library at runtime.
 *
 * Stash needs one per (treasury, stock): Jupiter pays the platform fee in the
 * output mint, into the account named as `feeAccount` (ISSUES #2). xStocks are
 * Token-2022 mints, and the token program is part of the derivation, so using
 * the classic token program here would produce an address that never exists.
 */
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "./constants";

export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): string {
  const [address] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  return address.toBase58();
}

/** Where the treasury receives Stash's fee for a given xStock. */
export function treasuryFeeAccount(treasury: string, stockMint: string): string {
  return associatedTokenAddress(treasury, stockMint, TOKEN_2022_PROGRAM_ID);
}
