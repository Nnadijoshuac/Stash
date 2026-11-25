import { describe, expect, it } from "vitest";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022,
  TOKEN_PROGRAM_ID as SPL_TOKEN,
} from "@solana/spl-token";
import { associatedTokenAddress, treasuryFeeAccount, TOKEN_PROGRAM_ID } from "./ata";
import { TOKEN_2022_PROGRAM_ID } from "./constants";
import { STOCKS } from "./allowlist";

describe("associated token addresses", () => {
  it("match the official SPL library for every allowlisted stock (Token-2022)", () => {
    const treasury = Keypair.generate().publicKey;
    for (const s of STOCKS) {
      const expected = getAssociatedTokenAddressSync(new PublicKey(s.mint), treasury, false, SPL_TOKEN_2022);
      expect(treasuryFeeAccount(treasury.toBase58(), s.mint)).toBe(expected.toBase58());
    }
  });

  it("differ between the classic and the Token-2022 program, which is why the program matters", () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const mint = STOCKS[0]!.mint;
    expect(associatedTokenAddress(owner, mint, TOKEN_PROGRAM_ID)).not.toBe(
      associatedTokenAddress(owner, mint, TOKEN_2022_PROGRAM_ID),
    );
    expect(TOKEN_PROGRAM_ID).toBe(SPL_TOKEN.toBase58());
    expect(TOKEN_2022_PROGRAM_ID).toBe(SPL_TOKEN_2022.toBase58());
  });
});
