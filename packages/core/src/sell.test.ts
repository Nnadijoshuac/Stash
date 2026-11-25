import { describe, expect, it } from "vitest";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { sellAmount, treasuryUsdcFeeAccount } from "./sell";

describe("sellAmount", () => {
  it("sells exactly the whole position at 100%, leaving no dust", () => {
    expect(sellAmount(123_456_789n, 10_000)).toBe(123_456_789n);
  });

  it("sells half, rounding down", () => {
    expect(sellAmount(101n, 5_000)).toBe(50n);
  });

  it("refuses 0% and anything above 100%", () => {
    expect(() => sellAmount(100n, 0)).toThrow(/more than 0%/);
    expect(() => sellAmount(100n, 10_001)).toThrow(/at most 100%/);
  });

  it("refuses to sell a stock the user does not hold", () => {
    expect(() => sellAmount(0n, 5_000)).toThrow(/do not hold/);
  });

  it("refuses a share so small it rounds to nothing", () => {
    expect(() => sellAmount(1n, 1)).toThrow(/smallest unit/);
  });
});

describe("treasuryUsdcFeeAccount", () => {
  it("is the treasury's classic-token USDC account, where sale fees land", () => {
    const treasury = Keypair.generate().publicKey;
    const expected = getAssociatedTokenAddressSync(
      new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
      treasury,
      false,
      TOKEN_PROGRAM_ID,
    );
    expect(treasuryUsdcFeeAccount(treasury.toBase58())).toBe(expected.toBase58());
  });
});
