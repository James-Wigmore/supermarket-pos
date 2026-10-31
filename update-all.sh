#!/usr/bin/env bash
# Applies every fix in all-fixes.patch, checks it, commits it, and (only if you say yes) publishes it to the installed apps.
# Run from the repo root in Git Bash:  bash update-all.sh
set -e
[ -f all-fixes.patch ] || { echo "Put all-fixes.patch in the repo root first."; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo "Switch to main first: git checkout main"; exit 1; }

echo "== 1/4 Returning the code to the last published state (everything is in the patch)"
git fetch origin main
git reset --hard origin/main
rm -f desktop/main/channel.ts frontend/src/lib/format.test.ts   # files an earlier patch created

echo "== 2/4 Applying the fixes"
git apply --3way --ignore-whitespace all-fixes.patch

echo "== 3/4 Running every check (stops here if anything fails)"
npm run check

git add -A ':!all-fixes.patch' ':!update-all.sh' 2>/dev/null || git add -A
git commit -m "Shift cash fixes, report totals, typed amounts, supplier and price checks, test channel"
echo
echo "Committed. Try it first if you like:  npm run desktop:dev   (uses a separate test data folder)"
read -r -p "== 4/4 Publish this to the installed apps now (new version, patch)? [y/N] " answer
if [ "$answer" = y ] || [ "$answer" = Y ]; then
  npm run release -- patch
else
  echo "Not published. When ready, run:  npm run release -- patch"
fi
