/** Fixed numbers Stash relies on. Mainnet only: xStocks don't exist on devnet. */

/** Circle's USDC on Solana. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** USDC has 6 decimals, so $1 is 1_000_000 base units. */
export const USDC_DECIMALS = 6;

/** xStocks are Token-2022 mints, not classic SPL tokens. */
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** The network rejects anything bigger. */
export const MAX_TRANSACTION_BYTES = 1232;

/** Warn before the hard limit. Routes change between quotes, so sizes move around. */
export const TRANSACTION_SIZE_WARNING_BYTES = 1150;

/** Accounts one transaction may lock, static and looked up. */
export const MAX_TRANSACTION_ACCOUNTS = 64;

/**
 * Two stocks per basket. With the on-chain receipt, two stocks came to 1,002
 * of 1,232 bytes. Three stocks alone already reach 1,095 to 1,261, so three
 * plus a receipt never fits.
 */
export const MAX_BASKET_LEGS = 2;

/** Weights are in basis points and must add up to this. */
export const FULL_WEIGHT_BPS = 10_000;

/** Stash's fee on each swap. 50 bps is 0.5%. Jupiter takes it in the output token. */
export const DEFAULT_PLATFORM_FEE_BPS = 50;

/** Max accounts per Jupiter route. 12 found no route for xStocks; 16 to 24 gave the same ones. */
export const DEFAULT_ROUTE_MAX_ACCOUNTS = 20;

/** xStock pools are thin outside market hours. */
export const DEFAULT_SLIPPAGE_BPS = 100;

/** Below $1 a leg isn't worth sending: the fee rounds to dust. */
export const MIN_LEG_USDC = 1_000_000n;
