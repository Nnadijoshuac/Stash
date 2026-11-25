/**
 * The app's saved state: whether the user confirmed eligibility, their rule,
 * and the stashes they have made. One JSON file under .stash/ (gitignored),
 * because this barebones app has one user, the fork's test wallet.
 * A database comes with real accounts, not before.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StashRule } from "@stash/core";

export interface StashRecord {
  signature: string;
  /** The incoming payment this stash came from. */
  paymentSignature: string;
  at: string;
  paymentUsdc: string;
  stashUsdc: string;
  legs: { symbol: string; usdc: string }[];
  computeUnits: number | null;
  bytes: number;
}

/** What the user decided about one incoming payment, keyed by its signature. */
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

const FILE = join(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.stash"), "app-state.json");
const EMPTY: AppState = { eligibleConfirmedAt: null, rule: null, stashes: [], payments: {}, sells: [] };

export function load(): AppState {
  if (!existsSync(FILE)) return structuredClone(EMPTY);
  return { ...structuredClone(EMPTY), ...(JSON.parse(readFileSync(FILE, "utf8")) as Partial<AppState>) };
}

export function save(state: AppState): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}
