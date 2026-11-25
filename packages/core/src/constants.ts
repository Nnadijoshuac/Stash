/**
 * Numbers Stash depends on, each with the reason it has the value it has.
 * Mainnet only: xStocks and their liquidity do not exist on devnet.
 */

/** Circle's USDC on Solana. Every stash starts from this mint. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** USDC has 6 decimals, so $1 is 1_000_000 base units. */
export const USDC_DECIMALS = 6;

/** xStocks are Token-2022 mints, not classic SPL tokens. */
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** A serialized transaction larger than this is rejected by the network. */
export const MAX_TRANSACTION_BYTES = 1232;

/**
 * Warn before the hard limit. Jupiter's routes change from one quote to the
 * next, so a basket that measured 1,118 bytes once can come back larger.
 */
export const TRANSACTION_SIZE_WARNING_BYTES = 1150;

/** Accounts a single transaction may lock, static and looked-up together. */
export const MAX_TRANSACTION_ACCOUNTS = 64;

/**
 * Three legs measured 1,118 of 1,232 bytes and 47 accounts on 25 Nov 2026.
 * A fourth would not fit with Jupiter's lookup tables alone.
 */
export const MAX_BASKET_LEGS = 3;

/** Weights are expressed in basis points and must add up to exactly this. */
export const FULL_WEIGHT_BPS = 10_000;

/** Stash's fee on each leg, taken by Jupiter in the output mint. 50 bps is 0.5%. */
export const DEFAULT_PLATFORM_FEE_BPS = 50;

/**
 * Caps how many accounts Jupiter may use per route. 12 found no route for
 * xStocks; 16 to 24 all returned the same compact routes. 20 leaves room.
 */
export const DEFAULT_ROUTE_MAX_ACCOUNTS = 20;

/** Slippage tolerated per leg. xStocks pools are thin away from market hours. */
export const DEFAULT_SLIPPAGE_BPS = 100;

/**
 * The smallest leg worth sending. Below $1 the platform fee rounds to dust
 * and fixed network costs dominate.
 */
export const MIN_LEG_USDC = 1_000_000n;
