// =============================================================================
// createCli — the single yargs chain that owns every freecode command.
//
// Pattern (borrowed from opencode): one file per command in cli/commands/,
// each exporting a yargs CommandModule; adding a command is one file + one
// .command() line here. Frontends inject their own commands (e.g. the TUI
// package passes its "$0" default command and "update") so core never has to
// import a frontend.
// =============================================================================

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { CommandModule } from "yargs";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { mcpCommand } from "./commands/mcp/index.js";
import { sessionCommand } from "./commands/session/index.js";
import { webCommand } from "./commands/web.js";
import { serveCommand } from "./commands/serve.js";

// ANSI color codes
const yellowBright = "\x1b[93m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

// Logo is inlined (not read from disk) so the CLI works inside the
// single-file compiled binary, where src/logo.txt has no real path.
const logoLines = [
  "█▀▀ █▀▀█ █▀▀ █▀▀ █▀▀ █▀▀█ █▀▀▄ █▀▀",
  "█▀▀ █▄▄▀ █▀▀ █▀▀ █▒▒ █▒▒█ █▒▒█ █▀▀",
  "▀   ▀ ▀▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀",
];

function printLogo() {
  console.log(
    "\n" +
      logoLines
        .map((line) => {
          const mid = Math.floor(line.length / 2);
          return `${yellowBright}${line.slice(0, mid)}${yellow}${line.slice(mid)}${reset}`;
        })
        .join("\n") +
      "\n",
  );
}

// Version: baked in for the compiled binary; read from package.json in dev.
export function resolveVersion(): string {
  if (process.env.FREECODE_BUILD_VERSION) {
    return process.env.FREECODE_BUILD_VERSION;
  }
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8"),
    );
    return packageJson.version;
  } catch {
    return "unknown";
  }
}

export function createCli(extraCommands: CommandModule[] = []) {
  // Print logo before yargs to avoid Unicode/formatting corruption
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printLogo();
  }

  let cli = yargs(hideBin(process.argv))
    .scriptName(`${yellowBright}freecode${reset}`)
    .usage("$0 [command] [options]")
    .option("h", {
      alias: "help",
      describe: "show help",
      type: "boolean",
    })
    .version(resolveVersion())
    .alias("v", "version")
    .command(mcpCommand)
    .command(sessionCommand)
    .command(webCommand)
    .command(serveCommand)
    .strict();

  for (const command of extraCommands) {
    cli = cli.command(command);
  }

  return cli;
}
