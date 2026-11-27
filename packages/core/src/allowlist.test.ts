import { describe, expect, it } from "vitest";
import { STOCKS, isAllowlisted, stockForMint } from "./allowlist";

// A real impostor from a Jupiter search: "NVDAXa", "NVIDA xStcok".
const IMPOSTOR_NVDA = "uBMY7k6fNhvSXDTe7ipDZJfEE6JTTb7tCo2o4Dqpump";

describe("allowlist", () => {
  it("finds a verified stock by its mint", () => {
    expect(stockForMint("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh").symbol).toBe("NVDAx");
  });

  it("refuses a look-alike token, however close its name is", () => {
    expect(isAllowlisted(IMPOSTOR_NVDA)).toBe(false);
    expect(() => stockForMint(IMPOSTOR_NVDA)).toThrow(/not on Stash's allowlist/);
  });

  it("refuses USDC itself as a stock", () => {
    expect(isAllowlisted("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(false);
  });

  it("has no duplicate mints or symbols", () => {
    expect(new Set(STOCKS.map((s) => s.mint)).size).toBe(STOCKS.length);
    expect(new Set(STOCKS.map((s) => s.symbol)).size).toBe(STOCKS.length);
  });

  it("only lists 8-decimal xStocks mints, which all start with Xs", () => {
    for (const s of STOCKS) {
      expect(s.decimals).toBe(8);
      expect(s.mint.startsWith("Xs")).toBe(true);
    }
  });

  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(STOCKS)).toBe(true);
  });
});
