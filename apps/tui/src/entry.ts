#!/usr/bin/env node
// =============================================================================
// entry.ts — binary entry point
//
// The distributed `freecode` binary (bun --compile) bundles the TUI shell and
// the core backend. Core's createCli() owns the whole command surface (mcp,
// session, web, serve, …); this file only injects the frontend-specific
// commands: the TUI as the "$0" default, and `update`. Adding future backend
// commands never touches this file — register them in core's create-cli.ts.
//
// In dev (`tsx src/index.ts`) the TUI is launched directly and this file is
// not on the hot path; it only matters for the compiled binary.
// =============================================================================

// @ts-ignore — resolved via core's package.json exports map
import { createCli } from "@thisisayande/freecode-core/cli/create-cli";
import type { CommandModule } from "yargs";

const tuiCommand: CommandModule = {
  command: "$0",
  describe: "start the freecode TUI",
  builder: (yargs) =>
    yargs.option("resume", {
      alias: "r",
      // string with no value (`--resume`) opens the session picker; with an id
      // it resumes directly. index.ts reads this back off process.argv.
      describe: "resume a previous session by id (omit id to pick from a list)",
      type: "string",
    }),
  handler: async () => {
    // Lazy: importing runs the TUI (index.ts calls tui.start()), and the
    // other commands must not pay its startup cost.
    await import("./index.js");
  },
};

const updateCommand: CommandModule = {
  command: "update",
  describe: "update freecode to the latest release",
  handler: async () => {
    const { spawnSync } = await import("child_process");
    const cmd = "curl -fsSL https://freecode.ayande.xyz/install | bash";
    process.stderr.write(`[freecode] updating: ${cmd}\n`);
    const r = spawnSync("bash", ["-c", cmd], { stdio: "inherit" });
    process.exit(r.status ?? 0);
  },
};

createCli([tuiCommand, updateCommand])
  .parseAsync()
  .catch((e: unknown) => {
    process.stderr.write(
      `[freecode] fatal: ${e instanceof Error ? e.stack : e}\n`,
    );
    process.exit(1);
  });
