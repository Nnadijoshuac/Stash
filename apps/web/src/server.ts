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
import { STOCKS, USDC_MINT, validateRule, type StashRule } from "@stash/core";
import { SURFNET_RPC_URL, assertSurfnet, loadOrCreateKeypair } from "@stash/fork";
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


