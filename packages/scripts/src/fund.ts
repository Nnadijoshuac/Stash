/**
 * Funds the test wallet, treasury and payer on the fork. Run it again after
 * every surfpool restart, since the fork keeps nothing. It refuses to run
 * against anything but a local fork.
 */
import { existsSync, readFileSync } from "node:fs";
import { STASH_PROGRAM_ID, STOCKS, TOKEN_2022_PROGRAM_ID, USDC_MINT, formatUsdc } from "@stash/core";
import { TOKEN_PROGRAM_ID } from "@stash/core";
import { assertSurfnet, loadProgram, setLamports, setTokenBalance, SURFNET_RPC_URL } from "@stash/fork";
import { loadOrCreateKeypair } from "@stash/fork";

const WALLET_SOL = 10 * 1e9;
const TREASURY_SOL = 1 * 1e9;
const WALLET_USDC = 1_000_000_000n; // $1,000 of test USDC
const PAYER_USDC = 100_000_000_000n; // $100,000 of test USDC to pay the user with

await assertSurfnet();
const wallet = loadOrCreateKeypair("wallet").publicKey.toBase58();
const treasury = loadOrCreateKeypair("treasury").publicKey.toBase58();

await setLamports(wallet, WALLET_SOL);
await setTokenBalance(wallet, USDC_MINT, WALLET_USDC, TOKEN_PROGRAM_ID);
console.log(`  wallet    ${wallet}: 10 SOL, ${formatUsdc(WALLET_USDC)} USDC`);

// Jupiter pays our fee into the treasury's account for each stock, so those
// accounts have to exist first. A zero balance creates them.
await setLamports(treasury, TREASURY_SOL);
for (const s of STOCKS) {
  await setTokenBalance(treasury, s.mint, 0n, TOKEN_2022_PROGRAM_ID);
}
// Fees on sales come in USDC, into this account.
await setTokenBalance(treasury, USDC_MINT, 0n, TOKEN_PROGRAM_ID);
console.log(`  treasury  ${treasury}: 1 SOL, fee accounts for ${STOCKS.map((s) => s.symbol).join(", ")} and USDC`);

// A payer that sends real transfers, so payments show up on chain like they would from a client.
const payer = loadOrCreateKeypair("payer").publicKey.toBase58();
await setLamports(payer, WALLET_SOL);
await setTokenBalance(payer, USDC_MINT, PAYER_USDC, TOKEN_PROGRAM_ID);
console.log(`  payer     ${payer}: 10 SOL, ${formatUsdc(PAYER_USDC)} USDC`);

// Our program is deployed on devnet, so load the same build into the fork.
const SO = new URL("../../../target/deploy/stash.so", import.meta.url);
if (existsSync(SO)) {
  await loadProgram(STASH_PROGRAM_ID.toBase58(), readFileSync(SO));
  console.log(`  program   ${STASH_PROGRAM_ID.toBase58()}: loaded from target/deploy/stash.so`);
} else {
  console.log("  program   NOT loaded: build it first (cargo build-sbf --manifest-path programs/stash/Cargo.toml)");
}

console.log(`\nFunded on ${SURFNET_RPC_URL}. Fake money only.`);
