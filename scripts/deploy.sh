#!/bin/bash
# Build and publish dist/ to the gh-pages branch.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
cd dist
git init -q && git checkout -qb gh-pages && git add -A
git -c user.email="aaron@modernhorizons.com" -c user.name="Aaron Mendelson" commit -qm "deploy $(date +%F)"
git push -f https://github.com/aaron-mendelson/guitar-cowriter.git gh-pages
cd .. && rm -rf dist/.git
echo "Deployed → https://aaron-mendelson.github.io/guitar-cowriter/"
