/**
 * Per-wallet state: eligibility, payment decisions, and stash and sale
 * history. One JSON file per wallet in .stash/users/ (gitignored). It's keyed
 * by public key and only holds things that are public on chain anyway.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import type { StashRule } from "@stash/core";

export interface StashRecord {
  signature: string;
  /** The payment this stash came from. */
  paymentSignature: string;
  at: string;
  paymentUsdc: string;
  stashUsdc: string;
  legs: { symbol: string; usdc: string }[];
  computeUnits: number | null;
  bytes: number;
}

/** What the user did with one payment, keyed by its signature. */
export interface PaymentDecision {
  status: "stashed" | "skipped";
  at: string;
  stashSignature?: string;
}

export interface SellRecord {
  signature: string;
  at: string;
  symbol: string;
  soldAmount: string;
  receivedUsdc: string;
}

export interface AppState {
  eligibleConfirmedAt: string | null;
  rule: StashRule | null;
  stashes: StashRecord[];
  payments: Record<string, PaymentDecision>;
  sells: SellRecord[];
}

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.stash"), "users");
const EMPTY: AppState = { eligibleConfirmedAt: null, rule: null, stashes: [], payments: {}, sells: [] };

/**
 * The owner as a base58 public key. Anything else is refused, which also stops
 * a crafted owner from pointing outside .stash/users.
 */
export function ownerKey(owner: unknown): string {
  try {
    return new PublicKey(String(owner ?? "")).toBase58();
  } catch {
    throw new Error("Connect a wallet first.");
  }
}

const fileFor = (owner: string) => join(DIR, `${ownerKey(owner)}.json`);

export function load(owner: string): AppState {
  const file = fileFor(owner);
  if (!existsSync(file)) return structuredClone(EMPTY);
  return { ...structuredClone(EMPTY), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<AppState>) };
}

export function save(owner: string, state: AppState): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileFor(owner), JSON.stringify(state, null, 2));
}
