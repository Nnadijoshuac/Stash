import { describe, expect, it } from "vitest";
import { allocate, formatUsdc, validateRule, type StashRule } from "./allocation";

const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDA = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TSLA = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const AAPL = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const usd = (n: number) => BigInt(Math.round(n * 1_000_000));

// The example carried through the README: 20% of every payment, 60% S&P 500, 40% Nvidia.
const RULE: StashRule = {
  stashBps: 2_000,
  basket: [
    { mint: SPY, weightBps: 6_000 },
    { mint: NVDA, weightBps: 4_000 },
  ],
};

describe("allocate", () => {
  it("stashes 20% of a $500 payment as $60 of S&P 500 and $40 of Nvidia", () => {
    const a = allocate(usd(500), RULE);
    expect(a.stashUsdc).toBe(usd(100));
    expect(a.legs.map((l) => [l.symbol, l.usdc])).toEqual([
      ["SPYx", usd(60)],
      ["NVDAx", usd(40)],
    ]);
  });

  it("gives rounding leftovers to the heaviest leg so nothing is lost", () => {
    const rule: StashRule = {
      stashBps: 10_000,
      basket: [
        { mint: SPY, weightBps: 6_667 },
        { mint: NVDA, weightBps: 3_333 },
      ],
    };
    const a = allocate(10_000_001n, rule);
    expect(a.legs.reduce((s, l) => s + l.usdc, 0n)).toBe(10_000_001n);
    expect(a.legs[0]!.usdc).toBeGreaterThan(a.legs[1]!.usdc);
  });

  it("always adds up to exactly the stashed amount", () => {
    const rule: StashRule = {
      stashBps: 1_337,
      basket: [
        { mint: SPY, weightBps: 7_001 },
        { mint: NVDA, weightBps: 2_999 },
      ],
    };
    for (let p = 60_000_000n; p < 400_000_000n; p += 7_777_777n) {
      const a = allocate(p, rule);
      expect(a.legs.reduce((s, l) => s + l.usdc, 0n)).toBe(a.stashUsdc);
      expect(a.stashUsdc).toBe((p * 1_337n) / 10_000n);
    }
  });

  it("refuses a payment too small to give every stock at least $1", () => {
    expect(() => allocate(usd(5), RULE)).toThrow(/too small to stash: NVDAx would get \$0\.40/);
  });

  it("refuses an empty payment", () => {
    expect(() => allocate(0n, RULE)).toThrow(/no payment/);
  });
});

describe("validateRule", () => {
  const rule = (stashBps: number, basket: StashRule["basket"]): StashRule => ({ stashBps, basket });

  it("accepts the README's example", () => {
    expect(() => validateRule(RULE)).not.toThrow();
  });

  it("refuses a stash share of 0% or above 100%", () => {
    expect(() => validateRule(rule(0, RULE.basket))).toThrow(/more than 0%/);
    expect(() => validateRule(rule(10_001, RULE.basket))).toThrow(/at most 100%/);
  });

  it("refuses shares that do not add up to 100%", () => {
    expect(() => validateRule(rule(2_000, [{ mint: SPY, weightBps: 5_000 }, { mint: NVDA, weightBps: 4_000 }]))).toThrow(
      /add up to 90%/,
    );
  });

  it("refuses more than two stocks, because the basket and its receipt must fit one transaction", () => {
    const three = [{ mint: SPY, weightBps: 4_000 }, { mint: NVDA, weightBps: 3_000 }, { mint: TSLA, weightBps: 3_000 }];
    expect(() => validateRule(rule(2_000, three))).toThrow(/at most 2 stocks/);
  });

  it("refuses the same stock twice", () => {
    expect(() => validateRule(rule(2_000, [{ mint: SPY, weightBps: 5_000 }, { mint: SPY, weightBps: 5_000 }]))).toThrow(
      /only once/,
    );
  });

  it("refuses a stock that is not on the allowlist", () => {
    expect(() =>
      validateRule(rule(2_000, [{ mint: "uBMY7k6fNhvSXDTe7ipDZJfEE6JTTb7tCo2o4Dqpump", weightBps: 10_000 }])),
    ).toThrow(/allowlist/);
  });

  it("refuses a stock with a 0% share", () => {
    expect(() => validateRule(rule(2_000, [{ mint: SPY, weightBps: 10_000 }, { mint: NVDA, weightBps: 0 }]))).toThrow(
      /above 0%/,
    );
  });
});

describe("formatUsdc", () => {
  it("formats base units as dollars and cents without floats", () => {
    expect(formatUsdc(1_000_000n)).toBe("$1.00");
    expect(formatUsdc(400_000n)).toBe("$0.40");
    expect(formatUsdc(123_456_789n)).toBe("$123.45");
  });
});
