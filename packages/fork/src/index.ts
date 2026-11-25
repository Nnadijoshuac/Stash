/**
 * Everything that only makes sense on a local mainnet fork: cheatcodes that
 * write fake balances, and the gitignored test keypairs. Shared by the e2e
 * scripts and the app's fork mode, so neither carries its own copy.
 */
export * from "./surfnet";
export * from "./keys";
export * from "./protect";
export * from "./pay";
