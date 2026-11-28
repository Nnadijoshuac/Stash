// Bundles the devnet web app (apps/mobile/web) into site/app, and the test
// payer into site/api/pay.js. Both reuse the Android app's lib/ and its
// node_modules, so the phone and the web send the same transactions.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mobile = join(root, "apps/mobile");
const common = { bundle: true, minify: true, logLevel: "warning", tsconfig: join(mobile, "tsconfig.json"), nodePaths: [join(mobile, "node_modules")] };

mkdirSync(join(root, "site/app"), { recursive: true });
mkdirSync(join(root, "site/api"), { recursive: true });
// The wallet modal (Reown AppKit) lives in web/node_modules. Its Solana
// adapter would bring a second @solana/web3.js; the alias keeps one copy, so a
// transaction built by lib/stash.ts is the class the wallet adapter expects.
const projectId = process.env.REOWN_PROJECT_ID;
if (!projectId) throw new Error("Set REOWN_PROJECT_ID (from cloud.reown.com) to build /app.");
await build({
  ...common,
  entryPoints: [join(mobile, "web/main.ts")],
  outfile: join(root, "site/app/app.js"),
  platform: "browser",
  inject: [join(mobile, "web/buffer-shim.ts")],
  format: "esm",
  splitting: false,
  target: "es2020",
  alias: { "@solana/web3.js": join(mobile, "node_modules/@solana/web3.js") },
  define: { "process.env.REOWN_PROJECT_ID": JSON.stringify(projectId), "process.env.NODE_ENV": '"production"', global: "globalThis" },
});
await build({ ...common, entryPoints: [join(mobile, "web/pay.ts")], outfile: join(root, "site/api/pay.js"), platform: "node", format: "cjs", target: "node20" });
copyFileSync(join(mobile, "web/index.html"), join(root, "site/app/index.html"));
copyFileSync(join(mobile, "web/app.css"), join(root, "site/app/app.css"));
console.log("built site/app and site/api/pay.js");
