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

/**
 * Loads a compiled Solana program (.so) into the fork at `programId`, as an
 * executable account of the BPF loader. Stash's program lives on devnet; the
 * fork is a copy of mainnet, so it is written in here at funding time.
 */
export async function loadProgram(programId: string, elf: Buffer): Promise<void> {
  await rpc("surfnet_setAccount", [
    programId,
    {
      lamports: 1_000_000_000,
      data: elf.toString("hex"),
      owner: "BPFLoader2111111111111111111111111111111111",
      executable: true,
    },
  ]);
}

/** Re-pulls one account from mainnet, replacing the fork's copy. */
export async function resetAccount(account: string): Promise<void> {
  await rpc("surfnet_resetAccount", [account]);
}

/**
 * Brings a route's pools up to date with mainnet before a stash is sent.
 *
 * The fork clones each pool the first time it is touched and never updates
 * it. Jupiter quotes against live mainnet. Oracle-priced venues such as GoonFi
 * then reject the swap (custom error 0x15) because the fork's copy is minutes
 * or hours old (ISSUES #7). Re-pulling the route's accounts just before
 * simulating closes that gap.
 *
 * Skipped:
 * - Sysvars and the system program: surfpool kills itself if asked to
 *   overwrite one (learned in Draw).
 * - Well-known program ids.
 * - `keep`: the wallet's and treasury's own token accounts, which hold the
 *   fake balances the cheatcodes wrote. Resetting those would wipe them.
 */
export async function refreshRoute(accounts: string[], keep: Iterable<string>): Promise<number> {
  const protectedSet = new Set(keep);
  const targets = accounts.filter(
    (a) =>
      !protectedSet.has(a) &&
      !a.startsWith("Sysvar") &&
      a !== "11111111111111111111111111111111" &&
      !/^(Token|ATokenGPvb|ComputeBudget|AddressLookupTab1e|JUP6Lkb)/.test(a),
  );
  for (const a of targets) await resetAccount(a);
  return targets.length;
}

/**
 * Seconds the fork's on-chain clock is ahead of real time (negative when behind).
 *
 * Reads the Clock sysvar, which is what programs like Whirlpool actually
 * check. getBlockTime() is only an estimate and lags: on 25 Nov it said the
 * fork was 11s behind while the Clock sysvar was 3s ahead, and time travel
 * then failed with "Cannot travel to past timestamp" (ISSUES #10).
 */
export async function clockDriftSeconds(): Promise<number> {
  const info = (await rpc("getAccountInfo", ["SysvarC1ock11111111111111111111111111111111", { encoding: "base64" }])) as {
    value: { data: [string, string] } | null;
  };
  if (!info.value) return 0;
  // Clock layout: slot u64, epoch_start_timestamp i64, epoch u64,
  // leader_schedule_epoch u64, unix_timestamp i64 (bytes 32..40).
  const unixTimestamp = Number(Buffer.from(info.value.data[0], "base64").readBigInt64LE(32));
  return unixTimestamp - Math.floor(Date.now() / 1000);
}

/**
 * Keeps the fork's clock at real time.
 *
 * The fork's clock drifts from the wall clock (it was 73 minutes behind on
 * 25 Nov). refreshRoute() pulls pools from mainnet stamped with the real
 * current time, and Whirlpool then refuses to swap: "InvalidTimestamp ...
 * Timestamp should be greater than the last updated timestamp" (6022,
 * ISSUES #10). surfnet_timeTravel moves the clock forward without a restart,
 * so the fake balances survive. A clock running ahead cannot be moved back;
 * that only matters if it is far ahead, and then needs a fork restart.
 *
 * Never throws: a failed sync is reported, and the stash's own simulation
 * decides whether it is safe to send.
 */
export async function syncClock(toleranceSeconds = 10): Promise<number> {
  const drift = await clockDriftSeconds();
  if (drift < -toleranceSeconds) {
    try {
      await rpc("surfnet_timeTravel", [{ absoluteTimestamp: Date.now() }]);
    } catch (e) {
      console.warn(`Could not move the fork clock forward: ${(e as Error).message}`);
    }
  } else if (drift > 120) {
    console.warn(`Fork clock is ${drift}s ahead of real time; restart surfpool and re-run pnpm fund.`);
  }
  return drift;
}

/** Everything a fork needs right before a stash is simulated: real-time clock, fresh pools. */
export async function prepareForkForSend(routeAccounts: string[], keep: Iterable<string>): Promise<void> {
  await syncClock();
  await refreshRoute(routeAccounts, keep);
}
