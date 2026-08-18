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

// A provider error that surfaces through a stream/event-emitter path (rather
// than a rejected promise — e.g. a Node stream emitting "error" with no
// listener) arrives here instead of unhandledRejection, and without this
// handler Bun's default reporter takes over: the raw SDK error object plus a
// minified-binary stack, then the whole daemon (every session, not just the
// one that hit the blip) dies. `serve` is long-running, so — same as
// unhandledRejection above — this deliberately does not process.exit();
// registering the handler is itself what stops Node from exiting.
process.on("uncaughtException", (e) => {
  console.error("Error:", formatFatalError(e));
});

createCli()
  .demandCommand(1, "Specify a command")
  .parseAsync()
  .catch((e) => {
    console.error("Error:", formatFatalError(e));
    process.exit(1);
  });
