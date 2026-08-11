#!/usr/bin/env node

// Core bin entry: the full CLI without a frontend. The distributed binary
// wraps the same chain via createCli() in apps/tui/src/entry.ts, adding the
// TUI as the "$0" default command.
import { createCli } from "./cli/create-cli.js";
import { formatFatalError } from "./cli/format-fatal-error.js";

// Background work (e.g. a fire-and-forget retry/fallback that exhausts its
// budget) can reject after the awaited chain below has already resolved.
// Left unhandled, Bun's default reporter dumps the raw error object; this
// keeps that path on the same clean one-liner as the awaited failure below.
process.on("unhandledRejection", (e) => {
  console.error("Error:", formatFatalError(e));
});

createCli()
  .demandCommand(1, "Specify a command")
  .parseAsync()
  .catch((e) => {
    console.error("Error:", formatFatalError(e));
    process.exit(1);
  });
