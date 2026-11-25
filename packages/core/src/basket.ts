/**
 * Packs every leg of a stash into ONE versioned transaction.
 *
 * That is the promise Stash makes: the whole basket lands, or nothing moves.
 * It only holds if the legs fit Solana's limits (1,232 bytes, 64 accounts),
 * and Jupiter's routes change from one quote to the next, so every build is
 * measured. A basket that would not fit is refused here, with the numbers,
 * rather than discovered by the network.
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

/**
 * The compute budget requested for a basket. Three Jupiter swaps have not
 * been simulated yet (ISSUES #4), so this asks for the per-transaction
 * maximum until a measurement replaces it.
 */
export const BASKET_COMPUTE_UNIT_LIMIT = 1_400_000;
export const BASKET_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000;

export interface PackInput {
  owner: PublicKey;
  /** Setup instructions per leg, in leg order. Duplicates across legs are dropped. */
  setup: TransactionInstruction[][];
  /** One swap instruction per leg, in leg order. */
  swaps: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
  recentBlockhash: string;
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

/**
 * Pure: no network. Builds the unsigned transaction and measures it.
 * Throws if it breaks a hard limit.
 */
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
  // web3.js serializes into a fixed 1,232-byte buffer and throws a bare
  // "encoding overruns Uint8Array" once a message is past it (ISSUES #5).
  // Catch that and say what it means. Otherwise measure the message and add
  // one 64-byte signature slot per required signer plus the length prefix.
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
}

export interface BuiltBasket extends Packed {
  quotes: JupiterQuote[];
}

/** Quotes every leg, fetches Jupiter's instructions and lookup tables, then packs. */
export async function buildBasket(input: BuildBasketInput): Promise<BuiltBasket> {
  const quotes: JupiterQuote[] = [];
  const setup: TransactionInstruction[][] = [];
  const swaps: TransactionInstruction[] = [];
  const tableAddresses = new Set<string>();

  for (const leg of input.allocation.legs) {
    const quote = await quoteLeg({
      outputMint: leg.mint,
      usdc: leg.usdc,
      ...(input.platformFeeBps !== undefined ? { platformFeeBps: input.platformFeeBps } : {}),
    });
    const ixs = await swapInstructions(quote, input.owner, treasuryFeeAccount(input.treasury, leg.mint));
    if (ixs.otherInstructions?.length || ixs.cleanupInstruction) {
      // Not seen for USDC -> xStocks so far. Refuse instead of guessing where they go.
      throw new Error(`Jupiter returned extra instructions for ${leg.symbol} that Stash does not place yet.`);
    }
    quotes.push(quote);
    setup.push(ixs.setupInstructions.map(toInstruction));
    swaps.push(toInstruction(ixs.swapInstruction));
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
  });
  return { ...packed, quotes };
}
