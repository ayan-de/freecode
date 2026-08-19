// =============================================================================
// Browser Chat — CLI commands
//
// Imported statically by create-cli.ts, so this file must stay metadata-only:
// type-only imports and lazy handlers. Pulling doctor.ts (and therefore
// Playwright) in at module scope would put the browser stack on every
// `freecode --help`.
// =============================================================================

import type { CommandModule } from "yargs";
import type { SiteId } from "./types.js";

const SITES = ["claude", "chatgpt"] as const;

function missingPlaywright(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "ERR_MODULE_NOT_FOUND" || /Cannot find (module|package)/.test(String(error))
  );
}

async function run(fn: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await fn();
  } catch (error) {
    if (missingPlaywright(error)) {
      console.error(
        "Browser mode needs Playwright, which is an optional dependency.\n" +
          "Install it with:  pnpm add -w playwright",
      );
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  }
}

const doctorCommand: CommandModule = {
  command: "doctor",
  describe: "Probe the browser transport and report which capabilities work",
  builder: (yargs) =>
    yargs
      .option("site", {
        type: "string",
        choices: SITES,
        default: "claude",
        describe: "Which chat site to probe",
      })
      .option("raw", {
        type: "boolean",
        default: false,
        describe: "Dump raw stream frames (use this to build test fixtures)",
      })
      .option("keep-open", {
        type: "boolean",
        default: false,
        describe: "Leave the tab open afterwards for inspection",
      }),
  handler: (argv) =>
    run(async () => {
      const { runDoctor } = await import("./doctor.js");
      return runDoctor({
        site: argv.site as SiteId,
        raw: argv.raw as boolean,
        keepOpen: argv["keep-open"] as boolean,
      });
    }),
};

const chatCommand: CommandModule = {
  command: "chat <prompt>",
  describe: "Send one prompt through the browser and stream the reply",
  builder: (yargs) =>
    yargs
      .positional("prompt", { type: "string", demandOption: true })
      .option("site", {
        type: "string",
        choices: SITES,
        default: "claude",
      })
      .option("transport", {
        type: "string",
        choices: ["cdp", "extension"] as const,
        default: "extension",
        describe:
          "extension: drive a tab in your own browser (needs apps/extension " +
          "loaded). cdp: launch a separate browser — blocked by bot protection " +
          "on claude.ai.",
      })
      .option("keep-open", { type: "boolean", default: false }),
  handler: (argv) =>
    run(async () => {
      const { runChat } = await import("./chat.js");
      return runChat({
        site: argv.site as SiteId,
        prompt: argv.prompt as string,
        keepOpen: argv["keep-open"] as boolean,
        transport: argv.transport as "cdp" | "extension",
      });
    }),
};

const captureCommand: CommandModule = {
  command: "capture",
  describe: "Record a live response stream into sites/fixtures/ as a test",
  builder: (yargs) =>
    yargs
      .option("site", { type: "string", choices: SITES, default: "claude" })
      .option("name", {
        type: "string",
        default: "sample",
        describe: "Fixture name, used as <site>-<name>.txt",
      }),
  handler: (argv) =>
    run(async () => {
      const { runCapture } = await import("./capture.js");
      return runCapture({
        site: argv.site as SiteId,
        name: String(argv.name).replace(/[^a-z0-9-]/gi, "-"),
      });
    }),
};

export const browserCommand: CommandModule = {
  command: "browser",
  describe: "Drive a logged-in chat site as a provider (experimental)",
  builder: (yargs) =>
    yargs
      .command(doctorCommand)
      .command(chatCommand)
      .command(captureCommand)
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {
    // Unreachable: demandCommand handles it.
  },
};
