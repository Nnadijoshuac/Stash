#!/bin/bash
# Builds the static landing page for hosting (Vercel) into site/.
# The app itself needs a local mainnet fork, so on the hosted site "/app"
# redirects to the README's run-locally steps instead of a page that cannot work.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf site
mkdir -p site/brand
cp apps/web/public/landing.html site/index.html
cp apps/web/public/landing.css site/
cp apps/web/public/brand/stash-splat-*.png site/brand/
cat > site/vercel.json <<'JSON'
{
  "redirects": [
    { "source": "/app", "destination": "https://github.com/Nnadijoshuac/Stash#x-running-it", "permanent": false }
  ]
}
JSON
echo "site/ ready: $(ls site | tr '\n' ' ')"
