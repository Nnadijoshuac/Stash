/**
 * Stash's barebones app server. Plain Node, no framework: the logic is the
 * product right now, and the UI is deliberately plain until it all works.
 *
 *   pnpm web        then open http://localhost:4321
 *
 * Fork mode only. The server refuses to start unless the RPC is a local
 * surfnet, and it signs with the fork's test wallet, so nothing here can move
 * real money. Connecting a real wallet comes with the real UI.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  STOCKS,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  allocate,
  buildBasket,
  stockForMint,
  validateRule,
  type StashRule,
} from "@stash/core";
import {
  SURFNET_RPC_URL,
  assertSurfnet,
  loadOrCreateKeypair,
  protectedAccounts,
  refreshRoute,
  setTokenBalance,
} from "@stash/fork";
import { load, save } from "./store";

const PORT = Number(process.env.PORT ?? 4321);
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

await assertSurfnet();
const connection = new Connection(SURFNET_RPC_URL, "confirmed");
const wallet = loadOrCreateKeypair("wallet");
const treasury = loadOrCreateKeypair("treasury").publicKey.toBase58();

async function balance(owner: string, mint: string): Promise<bigint> {
  const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  return res.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount as string), 0n);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

type Handler = (req: IncomingMessage) => Promise<unknown>;
const routes: Record<string, Handler> = {};

/** Everything the page shows: the wallet, its balances, the rule, history. */
routes["GET /api/state"] = async () => {
  const owner = wallet.publicKey.toBase58();
  const [usdc, holdings] = await Promise.all([
    balance(owner, USDC_MINT),
    Promise.all(STOCKS.map(async (s) => ({ ...s, amount: await balance(owner, s.mint) }))),
  ]);
  const state = load();
  return {
    network: "local mainnet fork (fake money)",
    wallet: owner,
    treasury,
    usdc,
    holdings,
    stocks: STOCKS,
    ...state,
  };
};

/** xStocks are not available to US persons, Canada, the UK or Australia. */
routes["POST /api/eligibility"] = async (req) => {
  const { confirm } = await readJson(req);
  if (confirm !== true) throw new Error("Confirm that you are eligible to hold xStocks to continue.");
  const state = load();
  state.eligibleConfirmedAt = new Date().toISOString();
  save(state);
  return { ok: true };
};

/** Saves the rule after the same validation the stash itself runs. */
routes["POST /api/rule"] = async (req) => {
  const rule = (await readJson(req)) as unknown as StashRule;
  validateRule(rule);
  const state = load();
  state.rule = { stashBps: rule.stashBps, basket: rule.basket.map((b) => ({ mint: b.mint, weightBps: b.weightBps })) };
  save(state);
  return { ok: true, rule: state.rule };
};

/** USDC base units from a request field, refusing anything that is not a whole number. */
function usdcField(body: Record<string, unknown>, field: string): bigint {
  const raw = String(body[field] ?? "");
  if (!/^[0-9]+$/.test(raw)) throw new Error("Enter an amount in USDC base units (whole number).");
  return BigInt(raw);
}

function requireRule(): StashRule {
  const { rule } = load();
  if (!rule) throw new Error("Set your rule first: how much to stash, and into which stocks.");
  return rule;
}

/**
 * What a stash of this payment would buy, with live quotes, and whether it
 * fits one transaction. Builds the transaction but never signs or sends it.
 */
routes["POST /api/preview"] = async (req) => {
  const paymentUsdc = usdcField(await readJson(req), "paymentUsdc");
  const allocation = allocate(paymentUsdc, requireRule());
  const built = await buildBasket({ connection, owner: wallet.publicKey.toBase58(), treasury, allocation });
  return {
    paymentUsdc,
    stashUsdc: allocation.stashUsdc,
    legs: allocation.legs.map((leg, i) => {
      const q = built.quotes[i]!;
      return {
        symbol: leg.symbol,
        tracks: stockForMint(leg.mint).tracks,
        usdc: leg.usdc,
        expectedShares: Number(q.outAmount) / 10 ** stockForMint(leg.mint).decimals,
        route: q.routePlan.map((r) => r.swapInfo.label ?? "?").join(" > "),
        feeBps: q.platformFee?.feeBps ?? 0,
      };
    }),
    bytes: built.bytes,
    accounts: built.accounts,
    warnings: built.warnings,
  };
};

/**
 * Stashes part of a payment: build, sign with the fork wallet, simulate, send.
 * Refuses until eligibility has been confirmed. Records the signature.
 */
routes["POST /api/stash"] = async (req) => {
  const state = load();
  if (!state.eligibleConfirmedAt) {
    throw new Error("Confirm you are eligible to hold xStocks before your first stash.");
  }
  const paymentUsdc = usdcField(await readJson(req), "paymentUsdc");
  const allocation = allocate(paymentUsdc, requireRule());
  const owner = wallet.publicKey.toBase58();
  const usdcBefore = await balance(owner, USDC_MINT);
  if (usdcBefore < allocation.stashUsdc) throw new Error("Not enough USDC in the wallet for this stash.");

  const built = await buildBasket({ connection, owner, treasury, allocation });
  // Fork mode: bring the route's pools up to date with mainnet first (ISSUES #7).
  await refreshRoute(built.routeAccounts, protectedAccounts(owner, treasury));
  built.transaction.sign([wallet]);
  const sim = await connection.simulateTransaction(built.transaction, { sigVerify: true });
  if (sim.value.err) {
    throw new Error(`The network would reject this stash (${JSON.stringify(sim.value.err)}). Nothing was sent.`);
  }
  const signature = await connection.sendRawTransaction(built.transaction.serialize(), { skipPreflight: true });
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) throw new Error(`The stash failed on chain. Signature ${signature}`);

  const record = {
    signature,
    at: new Date().toISOString(),
    paymentUsdc: paymentUsdc.toString(),
    stashUsdc: allocation.stashUsdc.toString(),
    legs: allocation.legs.map((l) => ({ symbol: l.symbol, usdc: l.usdc.toString() })),
    computeUnits: sim.value.unitsConsumed ?? null,
    bytes: built.bytes,
  };
  const fresh = load();
  fresh.stashes.unshift(record);
  save(fresh);
  return { ...record, spentUsdc: usdcBefore - (await balance(owner, USDC_MINT)) };
};

/**
 * Fork only: pretend a payment arrived by adding fake USDC to the wallet.
 * This stands in for "you got paid" until real wallets are connected.
 */
routes["POST /api/receive"] = async (req) => {
  const amount = usdcField(await readJson(req), "usdc");
  if (amount <= 0n || amount > 100_000_000_000n) throw new Error("Receive between $0 and $100,000 of fake USDC.");
  const owner = wallet.publicKey.toBase58();
  const next = (await balance(owner, USDC_MINT)) + amount;
  await setTokenBalance(owner, USDC_MINT, next, TOKEN_PROGRAM_ID);
  return { receivedUsdc: amount, usdc: next };
};

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  const file = resolve(PUBLIC, "." + (path === "/" ? "/index.html" : path));
  if (!file.startsWith(PUBLIC)) return send(res, 404, { error: "Not found" });
  const types: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": `${types[extname(file)] ?? "application/octet-stream"}; charset=utf-8` });
    res.end(body);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0]!;
  const handler = routes[`${req.method} ${path}`];
  if (!handler) {
    if (req.method === "GET" && !path.startsWith("/api/")) return serveStatic(path, res);
    return send(res, 404, { error: "Not found" });
  }
  try {
    send(res, 200, await handler(req));
  } catch (e) {
    send(res, 400, { error: (e as Error).message });
  }
}).listen(PORT, () => {
  console.log(`Stash (fork mode) on http://localhost:${PORT}  wallet ${wallet.publicKey.toBase58()}`);
});


