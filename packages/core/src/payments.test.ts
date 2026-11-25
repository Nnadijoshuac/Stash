import { describe, expect, it } from "vitest";
import { incomingUsdc, type ParsedTxLike, type TokenBalanceLike } from "./payments";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ME = "AFNHfJgSdEMeCDzFGvcARFYAnugNKVM4y3hEDoVCDBYv";
const PAYER = "9u1JNn2Tc7eWwg6tju82uaMZNBXoQhJrh1aqcA1FUqFu";
const OTHER = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

const bal = (owner: string, amount: bigint, mint = USDC): TokenBalanceLike => ({
  mint,
  owner,
  uiTokenAmount: { amount: amount.toString() },
});

function tx(opts: {
  signers: string[];
  pre: TokenBalanceLike[];
  post: TokenBalanceLike[];
  err?: unknown;
}): ParsedTxLike {
  return {
    slot: 100,
    blockTime: 1_764_000_000,
    meta: { err: opts.err ?? null, preTokenBalances: opts.pre, postTokenBalances: opts.post },
    transaction: {
      signatures: ["sig1"],
      message: { accountKeys: opts.signers.map((s) => ({ pubkey: s, signer: true })) },
    },
  };
}

describe("incomingUsdc", () => {
  it("reads a $500 payment from someone else, and who sent it", () => {
    const p = incomingUsdc(
      tx({
        signers: [PAYER],
        pre: [bal(PAYER, 2_000_000_000n), bal(ME, 100_000_000n)],
        post: [bal(PAYER, 1_500_000_000n), bal(ME, 600_000_000n)],
      }),
      ME,
    );
    expect(p).toMatchObject({ signature: "sig1", amountUsdc: 500_000_000n, from: PAYER });
  });

  it("counts a first payment into an account that did not exist before", () => {
    const p = incomingUsdc(
      tx({ signers: [PAYER], pre: [bal(PAYER, 50_000_000n)], post: [bal(PAYER, 0n), bal(ME, 50_000_000n)] }),
      ME,
    );
    expect(p?.amountUsdc).toBe(50_000_000n);
  });

  it("ignores the user's own stash, which they signed and which lowers their USDC", () => {
    expect(
      incomingUsdc(tx({ signers: [ME], pre: [bal(ME, 600_000_000n)], post: [bal(ME, 500_000_000n)] }), ME),
    ).toBeNull();
  });

  it("ignores anything the user signed, even if their USDC went up (e.g. selling a stock back)", () => {
    expect(
      incomingUsdc(tx({ signers: [ME], pre: [bal(ME, 0n)], post: [bal(ME, 40_000_000n)] }), ME),
    ).toBeNull();
  });

  it("ignores a failed transaction", () => {
    expect(
      incomingUsdc(
        tx({ signers: [PAYER], pre: [bal(ME, 0n)], post: [bal(ME, 500_000_000n)], err: { InstructionError: [0, "x"] } }),
        ME,
      ),
    ).toBeNull();
  });

  it("ignores a transfer between two other people", () => {
    expect(
      incomingUsdc(
        tx({ signers: [PAYER], pre: [bal(PAYER, 10n), bal(OTHER, 0n)], post: [bal(PAYER, 0n), bal(OTHER, 10n)] }),
        ME,
      ),
    ).toBeNull();
  });

  it("ignores tokens other than USDC arriving", () => {
    const stock = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
    expect(
      incomingUsdc(tx({ signers: [PAYER], pre: [bal(ME, 0n, stock)], post: [bal(ME, 5n, stock)] }), ME),
    ).toBeNull();
  });

  it("leaves the sender unknown when more than one wallet paid in", () => {
    const p = incomingUsdc(
      tx({
        signers: [PAYER],
        pre: [bal(PAYER, 10n), bal(OTHER, 10n), bal(ME, 0n)],
        post: [bal(PAYER, 5n), bal(OTHER, 5n), bal(ME, 10n)],
      }),
      ME,
    );
    expect(p).toMatchObject({ amountUsdc: 10n, from: null });
  });
});
