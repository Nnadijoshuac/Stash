#!/bin/bash
# Builds the static landing page for hosting (Vercel) into site/.
# The app itself needs a local mainnet fork, so on the hosted site "/app"
# redirects to the README's run-locally steps instead of a page that cannot work.
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep site/.vercel: it links this folder to the Vercel project "stash".
find site -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} + 2>/dev/null || true
mkdir -p site/brand
cp apps/web/public/landing.html site/index.html
cp apps/web/public/landing.css site/
cp apps/web/public/landing.js site/
cp apps/web/public/brand/stash-splat-*.png site/brand/
cat > site/vercel.json <<'JSON'
{
  "redirects": [
    { "source": "/app", "destination": "https://github.com/Nnadijoshuac/Stash#x-running-it", "permanent": false }
  ]
}
JSON
echo "site/ ready: $(ls site | tr '\n' ' ')"
