/**
 * Test keypairs for the fork. Created on first use in keys/, which is
 * gitignored. They only ever hold test money, but they still don't get committed.
 */
import { Keypair } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KEYS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../keys");

export function loadOrCreateKeypair(name: "wallet" | "treasury" | "payer"): Keypair {
  const file = join(KEYS_DIR, `${name}.keypair.json`);
  if (existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]));
  }
  mkdirSync(KEYS_DIR, { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`  created ${name} keypair at keys/${name}.keypair.json (gitignored)`);
  return kp;
}
