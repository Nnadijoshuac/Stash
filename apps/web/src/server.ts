/**
 * Stash's barebones app server. Plain Node, no framework.
 *
 *   pnpm web        then open http://localhost:4321
 *
 * NON-CUSTODIAL. The server never holds the user's key. It reads a wallet's
 * balances and payments from chain, builds unsigned transactions, and only
 * sends a transaction the wallet has signed, after checking it is exactly the
 * one it built (verifySignedTransaction). Rewritten 25 Nov from a version that
 * signed with a server-held test key (agent LOG, "PLAN: the user's wallet
 * signs").
 *
 * Fork mode only: the server refuses to start unless the RPC is a local
 * surfnet. /api/dev/fund and /api/receive hand out fake money there.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  STOCKS,
  USDC_MINT,
  allocate,
  buildBasket,
  buildSell,
  getIncomingPayment,
  getPrices,
  usdValue,
  listIncomingPayments,
  sellAmount,
  stockForMint,
  validateRule,
  verifySignedTransaction,
  type Allocation,
  type IncomingPayment,
  type StashRule,
} from "@stash/core";
import {
  SURFNET_RPC_URL,
  assertSurfnet,
  loadOrCreateKeypair,
  prepareForkForSend,
  protectedAccounts,
  sendUsdc,
  setLamports,
} from "@stash/fork";
import { load, ownerKey, save } from "./store";

const PORT = Number(process.env.PORT ?? 4321);
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
/** web3.js's browser build, served so the page can sign without a bundler. */
const WEB3_IIFE = join(
  dirname(createRequire(import.meta.url).resolve("@solana/web3.js/package.json")),
  "lib/index.iife.min.js",
);

await assertSurfnet();
const connection = new Connection(SURFNET_RPC_URL, "confirmed");
/** Only the treasury's public key is needed: it receives fees, it never signs. */
const treasury = loadOrCreateKeypair("treasury").publicKey.toBase58();
/** Fork-only test payer that sends users real (fake-money) USDC transfers. */
const payer = loadOrCreateKeypair("payer");

async function balance(owner: string, mint: string): Promise<bigint> {
  const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  return res.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount as string), 0n);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

/** Errors the client can fix by building and signing again (quotes moved, build expired). */
class RetryableError extends Error {}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

type Handler = (req: IncomingMessage, query: URLSearchParams) => Promise<unknown>;
const routes: Record<string, Handler> = {};

function usdcField(body: Record<string, unknown>, field: string): bigint {
  const raw = String(body[field] ?? "");
  if (!/^[0-9]+$/.test(raw)) throw new Error("Enter an amount in USDC base units (whole number).");
  return BigInt(raw);
}

function requireRule(owner: string): StashRule {
  const { rule } = load(owner);
  if (!rule) throw new Error("Set your rule first: how much to stash, and into which stocks.");
  return rule;
}

/**
 * The payment a request refers to. Only its signature comes from the client;
 * the amount is re-read from the chain. Refuses one already stashed or skipped.
 */
async function requirePayment(owner: string, body: Record<string, unknown>): Promise<IncomingPayment> {
  const signature = String(body.paymentSignature ?? "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new Error("Choose a payment to stash.");
  const decided = load(owner).payments[signature];
  if (decided) throw new Error(`That payment was already ${decided.status}.`);
  const payment = await getIncomingPayment(connection, owner, signature);
  if (!payment) throw new Error("That transaction is not a payment into this wallet.");
  return payment;
}

/* ------------------------------------------------------------------ reads */

routes["GET /api/state"] = async (_req, q) => {
  const owner = ownerKey(q.get("owner"));
  const [usdc, sol, amounts, prices] = await Promise.all([
    balance(owner, USDC_MINT),
    connection.getBalance(new PublicKey(owner)),
    Promise.all(STOCKS.map((s) => balance(owner, s.mint))),
    // Prices are display-only; the page still works without them.
    getPrices(STOCKS.map((s) => s.mint)).catch(() => ({}) as Awaited<ReturnType<typeof getPrices>>),
  ]);
  const holdings = STOCKS.map((s, i) => {
    const price = prices[s.mint];
    return { ...s, amount: amounts[i]!, usdPrice: price?.usdPrice ?? null, change24h: price?.change24h ?? null, usdValue: usdValue(amounts[i]!, s.decimals, price) };
  });
  const stashedUsd = holdings.reduce((sum, h) => sum + (h.usdValue ?? 0), 0);
  return { network: "local mainnet fork (fake money)", owner, treasury, usdc, sol, holdings, stashedUsd, stocks: STOCKS, ...load(owner) };
};

routes["GET /api/payments"] = async (_req, q) => {
  const owner = ownerKey(q.get("owner"));
  const found = await listIncomingPayments(connection, owner, { limit: 25 });
  const { payments } = load(owner);
  return found.map((p) => ({ ...p, decision: payments[p.signature] ?? null }));
};

/* ---------------------------------------------------------- preferences */

/** xStocks are not available to US persons, Canada, the UK or Australia. */
routes["POST /api/eligibility"] = async (req) => {
  const body = await readJson(req);
  const owner = ownerKey(body.owner);
  if (body.confirm !== true) throw new Error("Confirm that you are eligible to hold xStocks to continue.");
  const state = load(owner);
  state.eligibleConfirmedAt = new Date().toISOString();
  save(owner, state);
  return { ok: true };
};

routes["POST /api/rule"] = async (req) => {
  const body = await readJson(req);
  const owner = ownerKey(body.owner);
  const rule = { stashBps: body.stashBps, basket: body.basket } as unknown as StashRule;
  validateRule(rule);
  const state = load(owner);
  state.rule = { stashBps: rule.stashBps, basket: rule.basket.map((b) => ({ mint: b.mint, weightBps: b.weightBps })) };
  save(owner, state);
  return { ok: true, rule: state.rule };
};

routes["POST /api/skip"] = async (req) => {
  const body = await readJson(req);
  const owner = ownerKey(body.owner);
  const payment = await requirePayment(owner, body);
  const state = load(owner);
  state.payments[payment.signature] = { status: "skipped", at: new Date().toISOString() };
  save(owner, state);
  return { ok: true };
};

/* ------------------------------------------------------------- previews */

routes["POST /api/preview"] = async (req) => {
  const body = await readJson(req);
  const owner = ownerKey(body.owner);
  const payment = await requirePayment(owner, body);
  const allocation = allocate(payment.amountUsdc, requireRule(owner));
  const built = await buildBasket({ connection, owner, treasury, allocation });
  return {
    paymentSignature: payment.signature,
    paymentUsdc: payment.amountUsdc,
    stashUsdc: allocation.stashUsdc,
    legs: allocation.legs.map((leg, i) => {
      const q = built.quotes[i]!;
      const s = stockForMint(leg.mint);
      return {
        symbol: leg.symbol,
        tracks: s.tracks,
        usdc: leg.usdc,
        expectedShares: Number(q.outAmount) / 10 ** s.decimals,
        route: q.routePlan.map((r) => r.swapInfo.label ?? "?").join(" > "),
        feeBps: q.platformFee?.feeBps ?? 0,
      };
    }),
    bytes: built.bytes,
    accounts: built.accounts,
    warnings: built.warnings,
  };
};

async function sellRequest(owner: string, body: Record<string, unknown>) {
  const mint = String(body.mint ?? "");
  stockForMint(mint);
  const holding = await balance(owner, mint);
  return { mint, amount: sellAmount(holding, Math.round(Number(body.percent) * 100)), holding };
}

routes["POST /api/sell/preview"] = async (req) => {
  const body = await readJson(req);
  const owner = ownerKey(body.owner);
  const { mint, amount, holding } = await sellRequest(owner, body);
  const built = await buildSell({ connection, owner, treasury, mint, amount });
  const s = stockForMint(mint);
  return {
    symbol: s.symbol,
    tracks: s.tracks,
    holdingShares: Number(holding) / 10 ** s.decimals,
    sellShares: Number(amount) / 10 ** s.decimals,
    expectedUsdc: built.quote.outAmount,
    feeBps: built.quote.platformFee?.feeBps ?? 0,
    route: built.quote.routePlan.map((r) => r.swapInfo.label ?? "?").join(" > "),
    bytes: built.bytes,
  };
};

/* ------------------------------------------------ build, sign, submit */

/**
 * Transactions handed to a browser to sign, waiting to come back. Kept for
 * 90 seconds, a little less than a blockhash lives. Each build is used once.
 */
interface PendingBuild {
  owner: string;
  message: Uint8Array;
  routeAccounts: string[];
  expires: number;
  bytes: number;
  kind: "stash" | "sell";
  payment?: IncomingPayment;
  allocation?: Allocation;
  mint?: string;
  amount?: bigint;
}
const BUILD_TTL_MS = 90_000;
const pending = new Map<string, PendingBuild>();
/** Payments with a stash being submitted. A second submit for the same payment is refused. */
const inFlight = new Set<string>();

function remember(build: Omit<PendingBuild, "expires">): string {
  const now = Date.now();
  for (const [id, b] of pending) if (b.expires < now) pending.delete(id);
  const id = randomUUID();
  pending.set(id, { ...build, expires: now + BUILD_TTL_MS });
  return id;
}

const unsigned = (tx: { serialize(): Uint8Array }) => Buffer.from(tx.serialize()).toString("base64");

/** An unsigned stash transaction for one payment, for the wallet to sign. */
routes["POST /api/stash/build"] = async (req) => {
  const body = await readJson(req);
  const owner = ownerKey(body.owner);
  if (!load(owner).eligibleConfirmedAt) throw new Error("Confirm you are eligible to hold xStocks before your first stash.");
  const payment = await requirePayment(owner, body);
  if (inFlight.has(payment.signature)) throw new Error("This payment is already being stashed.");
  const allocation = allocate(payment.amountUsdc, requireRule(owner));
  if ((await balance(owner, USDC_MINT)) < allocation.stashUsdc) throw new Error("Not enough USDC in the wallet for this stash.");
  const built = await buildBasket({ connection, owner, treasury, allocation });
  const buildId = remember({
    owner,
    kind: "stash",
    message: built.transaction.message.serialize(),
    routeAccounts: built.routeAccounts,
    bytes: built.bytes,
    payment,
    allocation,
  });
  return { buildId, transaction: unsigned(built.transaction), stashUsdc: allocation.stashUsdc, bytes: built.bytes };
};

/** An unsigned sale for the wallet to sign. */
routes["POST /api/sell/build"] = async (req) => {
  const body = await readJson(req);
  const owner = ownerKey(body.owner);
  const { mint, amount } = await sellRequest(owner, body);
  const built = await buildSell({ connection, owner, treasury, mint, amount });
  const buildId = remember({
    owner,
    kind: "sell",
    message: built.transaction.message.serialize(),
    routeAccounts: built.routeAccounts,
    bytes: built.bytes,
    mint,
    amount,
  });
  return { buildId, transaction: unsigned(built.transaction), expectedUsdc: built.quote.outAmount, bytes: built.bytes };
};

/**
 * Sends a transaction the wallet signed, after checking it is exactly the one
 * built under `buildId` and signed by its owner. Simulated before sending;
 * if the network would reject it (quotes moved), nothing is sent and the
 * client is told to build and sign again.
 */
routes["POST /api/submit"] = async (req) => {
  const body = await readJson(req);
  const buildId = String(body.buildId ?? "");
  const build = pending.get(buildId);
  if (!build || build.expires < Date.now()) {
    pending.delete(buildId);
    throw new RetryableError("That transaction expired before it was signed. Build it again.");
  }
  const { transaction } = verifySignedTransaction(build.message, String(body.signedTransaction ?? ""), build.owner);
  pending.delete(buildId); // used once, whatever happens next

  const owner = build.owner;
  if (build.kind === "stash") {
    const sig = build.payment!.signature;
    if (load(owner).payments[sig]) throw new Error("That payment was already stashed or skipped.");
    if (inFlight.has(sig)) throw new Error("This payment is already being stashed.");
    inFlight.add(sig);
  }
  try {
    const usdcBefore = await balance(owner, USDC_MINT);
    // Fork mode: real-time clock and fresh pools before simulating (ISSUES #7, #10).
    await prepareForkForSend(build.routeAccounts, protectedAccounts(owner, treasury));
    const sim = await connection.simulateTransaction(transaction, { sigVerify: true });
    if (sim.value.err) {
      throw new RetryableError(
        `The network would reject this now (${JSON.stringify(sim.value.err)}); prices moved since you signed. Nothing was sent.`,
      );
    }
    const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    if (confirmation.value.err) throw new Error(`The transaction failed on chain. Signature ${signature}`);
    const usdcAfter = await balance(owner, USDC_MINT);
    const at = new Date().toISOString();
    const state = load(owner);

    if (build.kind === "stash") {
      const { payment, allocation } = build as Required<PendingBuild>;
      const record = {
        signature,
        paymentSignature: payment.signature,
        at,
        paymentUsdc: payment.amountUsdc.toString(),
        stashUsdc: allocation.stashUsdc.toString(),
        legs: allocation.legs.map((l) => ({ symbol: l.symbol, usdc: l.usdc.toString() })),
        computeUnits: sim.value.unitsConsumed ?? null,
        bytes: build.bytes,
      };
      state.stashes.unshift(record);
      state.payments[payment.signature] = { status: "stashed", at, stashSignature: signature };
      save(owner, state);
      return { kind: "stash", ...record, spentUsdc: usdcBefore - usdcAfter };
    }

    const record = {
      signature,
      at,
      symbol: stockForMint(build.mint!).symbol,
      soldAmount: build.amount!.toString(),
      receivedUsdc: (usdcAfter - usdcBefore).toString(),
    };
    state.sells.unshift(record);
    save(owner, state);
    return { kind: "sell", ...record };
  } finally {
    if (build.kind === "stash") inFlight.delete(build.payment!.signature);
  }
};

/* ------------------------------------------------------- fork-only money */

/** Fork only: gives a new wallet fake SOL for network fees. */
routes["POST /api/dev/fund"] = async (req) => {
  const owner = ownerKey((await readJson(req)).owner);
  await setLamports(owner, 1_000_000_000);
  return { ok: true, sol: 1 };
};

/** Fork only: the test payer sends this wallet a real (fake-money) USDC transfer. */
routes["POST /api/receive"] = async (req) => {
  const body = await readJson(req);
  const owner = ownerKey(body.owner);
  const amount = usdcField(body, "usdc");
  if (amount <= 0n || amount > 100_000_000_000n) throw new Error("Receive between $0 and $100,000 of fake USDC.");
  const signature = await sendUsdc(connection, payer, owner, amount);
  return { receivedUsdc: amount, signature };
};

/* ---------------------------------------------------------------- server */

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  // "/" is the landing page; "/app" is the app itself.
  const pages: Record<string, string> = { "/": "/landing.html", "/app": "/app.html", "/app/": "/app.html" };
  const file = path === "/vendor/web3.js" ? WEB3_IIFE : resolve(PUBLIC, "." + (pages[path] ?? path));
  if (file !== WEB3_IIFE && !file.startsWith(PUBLIC)) return send(res, 404, { error: "Not found" });
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
  const [path, qs] = (req.url ?? "/").split("?") as [string, string | undefined];
  const handler = routes[`${req.method} ${path}`];
  if (!handler) {
    if (req.method === "GET" && !path.startsWith("/api/")) return serveStatic(path, res);
    return send(res, 404, { error: "Not found" });
  }
  try {
    send(res, 200, await handler(req, new URLSearchParams(qs ?? "")));
  } catch (e) {
    send(res, e instanceof RetryableError ? 409 : 400, { error: (e as Error).message, retry: e instanceof RetryableError });
  }
}).listen(PORT, () => {
  console.log(`Stash (fork mode, non-custodial) on http://localhost:${PORT}`);
});
