/**
 * Surfpool cheatcodes for a local mainnet fork.
 *
 * xStocks and Jupiter's pools only exist on mainnet, so devnet can't run Stash.
 * Surfpool copies mainnet accounts the first time we read them and lets us
 * write balances directly, so the test wallets get SOL and USDC for free.
 *
 * Surfpool has no Windows build. Run it in WSL:
 *   surfpool start --no-tui --host 0.0.0.0 --rpc-url https://api.mainnet-beta.solana.com
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
 * Sets a token balance, creating the account if needed. Pass the token program:
 * without it surfpool assumes the classic one, and an xStock balance ends up
 * somewhere nothing reads.
 */
export async function setTokenBalance(owner: string, mint: string, amount: bigint, tokenProgram: string): Promise<void> {
  await rpc("surfnet_setTokenAccount", [owner, mint, { amount: Number(amount) }, tokenProgram]);
}

/** Writes our compiled program into the fork. It's deployed on devnet, not mainnet. */
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
 * Re-pulls a route's pools from mainnet before we simulate.
 *
 * The fork copies a pool once and never updates it, but Jupiter quotes live
 * mainnet. Oracle-priced pools like GoonFi then fail with 0x15. Sysvars and
 * program ids are skipped (resetting a sysvar crashes surfpool), and so are the
 * accounts in `keep`, which hold our fake balances.
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
 * How far the fork's clock is ahead of real time, in seconds (negative if behind).
 * Reads the Clock sysvar because that's what Whirlpool checks; getBlockTime()
 * lags and gave the wrong sign.
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
 * Moves the fork's clock up to real time when it falls behind.
 *
 * The fork drifts (we saw it 73 minutes behind). Pools refreshed from mainnet
 * then look newer than the clock and Whirlpool fails with 6022 InvalidTimestamp.
 * A clock that's ahead can't go back; if it's far ahead, restart surfpool.
 * Doesn't throw. The simulation decides whether it's safe to send.
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

/** Run before simulating on the fork: fix the clock, then refresh the pools. */
export async function prepareForkForSend(routeAccounts: string[], keep: Iterable<string>): Promise<void> {
  await syncClock();
  await refreshRoute(routeAccounts, keep);
}
