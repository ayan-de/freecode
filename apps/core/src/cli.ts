#!/usr/bin/env node

// Core bin entry: the full CLI without a frontend. The distributed binary
// wraps the same chain via createCli() in apps/tui/src/entry.ts, adding the
// TUI as the "$0" default command.
import { createCli } from "./cli/create-cli.js";

createCli()
  .demandCommand(1, "Specify a command")
  .parseAsync()
  .catch((e) => {
    console.error("Error:", (e as Error).message);
    process.exit(1);
  });
