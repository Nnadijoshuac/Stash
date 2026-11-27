#!/bin/bash
# Copies the landing page into site/ for Vercel. The app needs the local fork,
# so on the live site /app sends people to the README's setup steps.
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep site/.vercel, which links this folder to the Vercel project.
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
