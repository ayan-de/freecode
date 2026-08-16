#!/usr/bin/env bash
# freecode-serve-dev.sh — run the freecode core CLI straight from source via
# bun, bypassing the compiled `bun build --compile` binary. Used to test
# source fixes (e.g. the sessionId stream-correlation fix in bus/bridge.ts)
# without paying for a full ~95MB recompile on every iteration.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Hardcoded absolute path: T3 Code spawns this with its own curated
# environment, which does not necessarily include the mise shim directory
# on PATH, so a bare `bun` lookup fails silently (process exits immediately,
# no stderr captured before the pipe closes).
BUN_BIN="/home/ayan-de/.local/share/mise/installs/bun/1.3.14/bin/bun"
if [ ! -x "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun)"
fi
exec "$BUN_BIN" run "$REPO_ROOT/apps/core/src/cli.ts" "$@"
