/**
 * Saved state per wallet: eligibility, the rule, payment decisions, and the
 * history of stashes and sales.
 *
 * One JSON file per owner under .stash/users/ (gitignored). The server holds
 * no keys, so state is keyed by the public key the browser presents; anyone
 * can read state for a public key, which is fine because it only describes
 * public on-chain activity and preferences. A database comes with real
 * accounts and sessions, not before.
 *
 * Changed 25 Nov from a single app-state.json when signing moved to the
 * browser and one server started serving many wallets (agent LOG).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
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

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.stash"), "users");
const EMPTY: AppState = { eligibleConfirmedAt: null, rule: null, stashes: [], payments: {}, sells: [] };

/**
 * The owner as a canonical base58 public key. Refuses anything else, which
 * also keeps a crafted "owner" from naming a path outside .stash/users.
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
