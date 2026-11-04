#!/usr/bin/env bash
# Fail if a flag-less `npm ci` cannot resolve the dependency tree
# (e.g. ERESOLVE on grammar peer ranges). Runs on a clean copy of the manifest
# and lockfile, so the working tree's node_modules is never touched.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$root/package.json" "$root/package-lock.json" "$tmp/"
cd "$tmp"
npm ci --ignore-scripts --no-audit --no-fund
echo "plain npm ci: ok"
