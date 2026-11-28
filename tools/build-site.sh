#!/bin/bash
# Builds site/ for Vercel: the landing page at /, the devnet app at /app and
# the test payer at /api/pay. The full app with stock swaps needs the local
# mainnet fork, so it isn't hosted; the README has the setup steps.
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep site/.vercel, which links this folder to the Vercel project.
find site -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} + 2>/dev/null || true
mkdir -p site/brand
cp apps/web/public/landing.html site/index.html
cp apps/web/public/landing.css site/
cp apps/web/public/landing.js site/
cp apps/web/public/brand/stash-splat-*.png site/brand/
node tools/build-demo.mjs
echo "site/ ready: $(ls site | tr '\n' ' ')"
