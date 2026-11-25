/**
 * Surfpool cheatcodes, for a local mainnet fork that costs nothing.
 *
 * xStocks and Jupiter's pools only exist on mainnet, so devnet cannot run
 * Stash. A surfnet forks mainnet copy-on-read: every account we touch (the
 * xStocks mints, Jupiter's pools, lookup tables) is the real thing, fetched
 * on first use. On top of that it exposes `surfnet_*` methods that write
 * accounts directly, which is how a test wallet gets SOL and USDC without
 * anyone spending a cent.
 *
 * Adapted from Draw (github.com/Nnadijoshuac/draw, packages/scripts/src/surfnet.ts),
 * the author's earlier project, and rewritten for @solana/web3.js.
 *
 * Start the fork (surfpool has no Windows build, so it runs in WSL):
 *   wsl -d Ubuntu -- bash -lc '~/.local/bin/surfpool start --no-tui --host 0.0.0.0 \
 *     --rpc-url https://api.mainnet-beta.solana.com'
 */

export const SURFNET_RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";

interface RpcError {
  code: number;
  message: string;
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(SURFNET_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method} failed: ${res.status} ${res.statusText}. Is surfpool running?`);
  const body = (await res.json()) as { result?: unknown; error?: RpcError };
  if (body.error) {
    if (body.error.code === -32601) {
      throw new Error(`This surfpool does not expose "${method}". Check "surfpool --version" against its docs.`);
    }
    throw new Error(`${method} failed: ${body.error.message}`);
  }
  return body.result;
}

/** Refuse to run cheatcodes against anything that is not a local surfnet. */
export async function assertSurfnet(): Promise<void> {
  const version = (await rpc("getVersion", []).catch(() => null)) as Record<string, unknown> | null;
  if (!version || !("surfnet-version" in version)) {
    throw new Error(
      `${SURFNET_RPC_URL} is not a surfnet. These scripts only hand out fake money on a local fork; ` +
        `they will not run against a real network.`,
    );
  }
}

export async function setLamports(account: string, lamports: number): Promise<void> {
  await rpc("surfnet_setAccount", [account, { lamports }]);
}

/**
 * Writes a token balance directly, creating the token account if needed.
 *
 * The token program must be passed explicitly. Without it surfpool writes to
 * the classic program, and for a Token-2022 mint like an xStock the balance
 * lands at an address nothing reads (a lesson from Draw).
 */
export async function setTokenBalance(owner: string, mint: string, amount: bigint, tokenProgram: string): Promise<void> {
  await rpc("surfnet_setTokenAccount", [owner, mint, { amount: Number(amount) }, tokenProgram]);
}
