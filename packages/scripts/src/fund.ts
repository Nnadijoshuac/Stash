/**
 * Gives the test wallet and treasury everything a stash needs, on the fork.
 *
 *   pnpm fund
 *
 * Run it again whenever surfpool restarts: the fork keeps no state between runs.
 * All of it is fake money on a local surfnet. assertSurfnet() refuses to run
 * against anything else.
 */
import { STOCKS, TOKEN_2022_PROGRAM_ID, USDC_MINT, formatUsdc } from "@stash/core";
import { TOKEN_PROGRAM_ID } from "@stash/core";
import { assertSurfnet, setLamports, setTokenBalance, SURFNET_RPC_URL } from "@stash/fork";
import { loadOrCreateKeypair } from "@stash/fork";

const WALLET_SOL = 10 * 1e9;
const TREASURY_SOL = 1 * 1e9;
const WALLET_USDC = 1_000_000_000n; // $1,000 of fake USDC

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
console.log(`  treasury  ${treasury}: 1 SOL, fee accounts for ${STOCKS.map((s) => s.symbol).join(", ")}`);
console.log(`\nFunded on ${SURFNET_RPC_URL}. Fake money only.`);
