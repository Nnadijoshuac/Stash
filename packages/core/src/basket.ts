/**
 * Packs a whole stash into one transaction, so every stock lands or none do.
 * Routes change between quotes, so each build is measured and refused here if
 * it won't fit (1,232 bytes, 64 accounts).
 */
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Allocation } from "./allocation";
import { treasuryFeeAccount } from "./ata";
import {
  MAX_TRANSACTION_ACCOUNTS,
  MAX_TRANSACTION_BYTES,
  TRANSACTION_SIZE_WARNING_BYTES,
} from "./constants";
import { quoteLeg, swapInstructions, toInstruction, type JupiterQuote } from "./jupiter";
import { recordStashInstruction } from "./program";

/**
 * Compute budget for a basket. Two stocks used about 197k units and three
 * about 253k, so 500k leaves room without paying priority fees on the 1.4M max.
 */
export const BASKET_COMPUTE_UNIT_LIMIT = 500_000;
export const BASKET_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000;

export interface PackInput {
  owner: PublicKey;
  /** Setup instructions per leg, in leg order. Duplicates across legs are dropped. */
  setup: TransactionInstruction[][];
  /** One swap instruction per leg, in leg order. */
  swaps: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
  recentBlockhash: string;
  /** Goes after the swaps. Used for the on-chain receipt. */
  after?: TransactionInstruction[];
  computeUnitLimit?: number;
  computeUnitPriceMicroLamports?: number;
}

export interface Packed {
  transaction: VersionedTransaction;
  bytes: number;
  accounts: number;
  instructions: number;
  warnings: string[];
}

function fingerprint(ix: TransactionInstruction): string {
  return [
    ix.programId.toBase58(),
    ...ix.keys.map((k) => `${k.pubkey.toBase58()}:${k.isSigner ? 1 : 0}${k.isWritable ? 1 : 0}`),
    Buffer.from(ix.data).toString("base64"),
  ].join("|");
}

/** Builds the unsigned transaction and measures it. No network calls. Throws if it's too big. */
export function packBasket(input: PackInput): Packed {
  const seen = new Set<string>();
  const setup: TransactionInstruction[] = [];
  for (const legSetup of input.setup) {
    for (const ix of legSetup) {
      const key = fingerprint(ix);
      if (!seen.has(key)) {
        seen.add(key);
        setup.push(ix);
      }
    }
  }

  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: input.computeUnitLimit ?? BASKET_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: input.computeUnitPriceMicroLamports ?? BASKET_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
    }),
    ...setup,
    ...input.swaps,
    ...(input.after ?? []),
  ];

  const message = new TransactionMessage({
    payerKey: input.owner,
    recentBlockhash: input.recentBlockhash,
    instructions,
  }).compileToV0Message(input.lookupTables);

  const accounts =
    message.staticAccountKeys.length +
    message.addressTableLookups.reduce((n, t) => n + t.writableIndexes.length + t.readonlyIndexes.length, 0);

  if (accounts > MAX_TRANSACTION_ACCOUNTS) {
    throw new Error(
      `This basket needs ${accounts} accounts; a transaction allows ${MAX_TRANSACTION_ACCOUNTS}. Try fewer stocks.`,
    );
  }

  const transaction = new VersionedTransaction(message);
  // web3.js throws "encoding overruns Uint8Array" once a message passes 1,232
  // bytes, so turn that into a useful error. Size = message + 64 bytes per
  // signer + 1 length byte.
  let messageBytes: number;
  try {
    messageBytes = message.serialize().length;
  } catch (e) {
    if (e instanceof RangeError || /overruns/.test(String(e))) {
      throw new Error(
        `This basket is over ${MAX_TRANSACTION_BYTES} bytes, the most a transaction allows. Try fewer stocks.`,
      );
    }
    throw e;
  }
  const bytes = 1 + 64 * message.header.numRequiredSignatures + messageBytes;
  if (bytes > MAX_TRANSACTION_BYTES) {
    throw new Error(
      `This basket is ${bytes} bytes; a transaction allows ${MAX_TRANSACTION_BYTES}. Try fewer stocks.`,
    );
  }

  const warnings: string[] = [];
  if (bytes > TRANSACTION_SIZE_WARNING_BYTES) {
    warnings.push(`Close to the size limit: ${bytes} of ${MAX_TRANSACTION_BYTES} bytes.`);
  }
  return { transaction, bytes, accounts, instructions: instructions.length, warnings };
}

export interface BuildBasketInput {
  connection: Connection;
  owner: string;
  treasury: string;
  allocation: Allocation;
  platformFeeBps?: number;
  /**
   * The payment being stashed. If set, the transaction also writes its
   * on-chain receipt, so the same payment can't be stashed twice.
   */
  paymentSignature?: string;
}

export interface BuiltBasket extends Packed {
  quotes: JupiterQuote[];
  /**
   * Every account the swaps touch. The fork re-pulls these from mainnet
   * before sending.
   */
  routeAccounts: string[];
}

/** Quotes every leg, gets Jupiter's instructions and lookup tables, and packs them. */
export async function buildBasket(input: BuildBasketInput): Promise<BuiltBasket> {
  const quotes: JupiterQuote[] = [];
  const setup: TransactionInstruction[][] = [];
  const swaps: TransactionInstruction[] = [];
  const tableAddresses = new Set<string>();
  const routeAccounts = new Set<string>();

  for (const leg of input.allocation.legs) {
    const quote = await quoteLeg({
      outputMint: leg.mint,
      usdc: leg.usdc,
      ...(input.platformFeeBps !== undefined ? { platformFeeBps: input.platformFeeBps } : {}),
    });
    const ixs = await swapInstructions(quote, input.owner, treasuryFeeAccount(input.treasury, leg.mint));
    if (ixs.otherInstructions?.length || ixs.cleanupInstruction) {
      // Haven't seen these for USDC to xStocks. Refuse rather than guess.
      throw new Error(`Jupiter returned extra instructions for ${leg.symbol} that Stash does not place yet.`);
    }
    quotes.push(quote);
    setup.push(ixs.setupInstructions.map(toInstruction));
    swaps.push(toInstruction(ixs.swapInstruction));
    ixs.swapInstruction.accounts.forEach((a) => routeAccounts.add(a.pubkey));
    ixs.addressLookupTableAddresses.forEach((a) => tableAddresses.add(a));
  }

  const lookupTables = (
    await Promise.all([...tableAddresses].map((a) => input.connection.getAddressLookupTable(new PublicKey(a))))
  )
    .map((r) => r.value)
    .filter((t): t is AddressLookupTableAccount => t !== null);

  const { blockhash } = await input.connection.getLatestBlockhash("confirmed");
  const packed = packBasket({
    owner: new PublicKey(input.owner),
    setup,
    swaps,
    lookupTables,
    recentBlockhash: blockhash,
    ...(input.paymentSignature
      ? {
          after: [
            recordStashInstruction(
              new PublicKey(input.owner),
              input.paymentSignature,
              input.allocation.paymentUsdc,
              input.allocation.stashUsdc,
            ),
          ],
        }
      : {}),
  });
  return { ...packed, quotes, routeAccounts: [...routeAccounts] };
}
