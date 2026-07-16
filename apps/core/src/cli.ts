#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { mcpCommand } from "./cli/commands/mcp/index.js";
import { sessionCommand } from "./cli/commands/session/index.js";
import { webCommand } from "./cli/commands/web.js";

// Logo is inlined (not read from disk) so the CLI works inside the
// single-file compiled binary, where src/logo.txt has no real path.
const logoLines = [
  "█▀▀ █▀▀█ █▀▀ █▀▀ █▀▀ █▀▀█ █▀▀▄ █▀▀",
  "█▀▀ █▄▄▀ █▀▀ █▀▀ █▒▒ █▒▒█ █▒▒█ █▀▀",
  "▀   ▀ ▀▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀",
];

// Version: baked in for the compiled binary; read from package.json in dev.
function resolveVersion(): string {
  if (process.env.FREECODE_BUILD_VERSION) {
    return process.env.FREECODE_BUILD_VERSION;
  }
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
    );
    return packageJson.version;
  } catch {
    return "unknown";
  }
}
const version = resolveVersion();

// ANSI color codes
const yellowBright = "\x1b[93m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

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

async function main() {
  // Print logo before yargs to avoid Unicode/formatting corruption
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printLogo();
  }

  const argv = await yargs(hideBin(process.argv))
    .scriptName(`${yellowBright}freecode${reset}`)
    .usage("$0 [command] [options]")
    .option("h", {
      alias: "help",
      describe: "show help",
      type: "boolean",
    })
    .version(version)
    .command(mcpCommand)
    .command(sessionCommand)
    .command(webCommand)
    .demandCommand(1, "Specify a command")
    .strict()
    .parseAsync();

  // If no MCP, session, or web command, start the JSON-RPC server (lazy import to avoid loading tools)
  if (
    !argv._.includes("mcp") &&
    !argv._.includes("session") &&
    !argv._.includes("web")
  ) {
    const { startServer } = await import("./server.js");
    startServer();
  }
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exit(1);
});
