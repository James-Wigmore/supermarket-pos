#!/usr/bin/env bash
# Applies the activation-key patch (plus the comment-stripping build change), checks it, commits it,
# then optionally sets up your licence keys and publishes the release.
# Run from the repo root in Git Bash:  bash update-activation.sh
set -e
[ -f activation-and-hardening.patch ] || { echo "Put activation-and-hardening.patch in the repo root first."; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo "Switch to main first: git checkout main"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "You have uncommitted changes. Commit or stash them first, then re-run."; exit 1; }

echo "== 1/3 Applying the activation-key feature"
git apply --3way --ignore-whitespace activation-and-hardening.patch

echo "== 2/3 Running every check (stops here if anything fails)"
npm run check

git add -A
git commit -m "PC-locked activation keys; strip comments from the packaged backend"
echo
echo "Committed. Try it first:  npm run desktop:test   (builds a TEST installer that also asks for a key)"
echo
echo "Before this can lock anything, set up your licence keys ONCE (safe to skip for now):"
echo "  npm run license -- init"
echo "This writes desktop/main/licenseKey.ts (commit it) and a private key kept OUTSIDE the repo — back it up, never share it."
echo
read -r -p "== 3/3 Publish this to the installed apps now (new version, patch)? [y/N] " answer
if [ "$answer" = y ] || [ "$answer" = Y ]; then
  npm run release -- patch
else
  echo "Not published. When ready:  npm run release -- patch"
fi
