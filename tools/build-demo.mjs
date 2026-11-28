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
await build({ ...common, entryPoints: [join(mobile, "web/main.ts")], outfile: join(root, "site/app/app.js"), platform: "browser", inject: [join(mobile, "web/buffer-shim.ts")], format: "iife", target: "es2020" });
await build({ ...common, entryPoints: [join(mobile, "web/pay.ts")], outfile: join(root, "site/api/pay.js"), platform: "node", format: "cjs", target: "node20" });
copyFileSync(join(mobile, "web/index.html"), join(root, "site/app/index.html"));
copyFileSync(join(mobile, "web/app.css"), join(root, "site/app/app.css"));
console.log("built site/app and site/api/pay.js");
