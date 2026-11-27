/**
 * Gives the test wallet and treasury everything a stash needs, on the fork.
 *
 *   pnpm fund
 *
 * Run it again whenever surfpool restarts: the fork keeps no state between runs.
 * All of it is fake money on a local surfnet. assertSurfnet() refuses to run
 * against anything else.
 */
import { existsSync, readFileSync } from "node:fs";
import { STASH_PROGRAM_ID, STOCKS, TOKEN_2022_PROGRAM_ID, USDC_MINT, formatUsdc } from "@stash/core";
import { TOKEN_PROGRAM_ID } from "@stash/core";
import { assertSurfnet, loadProgram, setLamports, setTokenBalance, SURFNET_RPC_URL } from "@stash/fork";
import { loadOrCreateKeypair } from "@stash/fork";

const WALLET_SOL = 10 * 1e9;
const TREASURY_SOL = 1 * 1e9;
const WALLET_USDC = 1_000_000_000n; // $1,000 of fake USDC
const PAYER_USDC = 100_000_000_000n; // $100,000 of fake USDC to pay the user with

await assertSurfnet();
const wallet = loadOrCreateKeypair("wallet").publicKey.toBase58();
const treasury = loadOrCreateKeypair("treasury").publicKey.toBase58();

await setLamports(wallet, WALLET_SOL);
await setTokenBalance(wallet, USDC_MINT, WALLET_USDC, TOKEN_PROGRAM_ID);
console.log(`  wallet    ${wallet}: 10 SOL, ${formatUsdc(WALLET_USDC)} USDC`);

// Jupiter pays Stash's fee into the treasury's token account for each stock,
// and that account has to exist before the swap (ISSUES #2). A zero balance
// is enough to create it.
await setLamports(treasury, TREASURY_SOL);
for (const s of STOCKS) {
  await setTokenBalance(treasury, s.mint, 0n, TOKEN_2022_PROGRAM_ID);
}
// Selling back to USDC pays the fee in USDC, into this account.
await setTokenBalance(treasury, USDC_MINT, 0n, TOKEN_PROGRAM_ID);
console.log(`  treasury  ${treasury}: 1 SOL, fee accounts for ${STOCKS.map((s) => s.symbol).join(", ")} and USDC`);

// A test payer that sends real token transfers, so payments show up on chain
// the way a client's or a hackathon's would.
const payer = loadOrCreateKeypair("payer").publicKey.toBase58();
await setLamports(payer, WALLET_SOL);
await setTokenBalance(payer, USDC_MINT, PAYER_USDC, TOKEN_PROGRAM_ID);
console.log(`  payer     ${payer}: 10 SOL, ${formatUsdc(PAYER_USDC)} USDC`);

// Stash's own program (programs/stash) is deployed on devnet. The fork is a
// copy of mainnet, so the same compiled program is written in here.
const SO = new URL("../../../target/deploy/stash.so", import.meta.url);
if (existsSync(SO)) {
  await loadProgram(STASH_PROGRAM_ID.toBase58(), readFileSync(SO));
  console.log(`  program   ${STASH_PROGRAM_ID.toBase58()}: loaded from target/deploy/stash.so`);
} else {
  console.log("  program   NOT loaded: build it first (cargo build-sbf --manifest-path programs/stash/Cargo.toml)");
}

console.log(`\nFunded on ${SURFNET_RPC_URL}. Fake money only.`);
