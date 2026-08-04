#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REMOTE_URL=$(git -C "$ROOT" remote get-url origin)
DEPLOY_DIR=$(mktemp -d)
trap 'rm -rf "$DEPLOY_DIR"' EXIT

cd "$ROOT"
GITHUB_PAGES=true npm run build
test -f out/index.html
touch out/.nojekyll

cp -a out/. "$DEPLOY_DIR/"
git -C "$DEPLOY_DIR" init --quiet
git -C "$DEPLOY_DIR" checkout --orphan gh-pages --quiet
git -C "$DEPLOY_DIR" add -A
git -C "$DEPLOY_DIR" commit --quiet -m "deploy: $(git -C "$ROOT" rev-parse --short HEAD)"
git -C "$DEPLOY_DIR" push --force "$REMOTE_URL" HEAD:gh-pages

printf 'GitHub Pages artifact pushed: https://doheon-kim1.github.io/hellbreak/\n'
