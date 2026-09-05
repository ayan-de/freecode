import type { CommandModule } from "yargs";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { CONFIG_DIR } from "../../providers/config.js";

interface UninstallArgs {
  force: boolean;
  purge: boolean;
  "dry-run": boolean;
}

/** One thing to delete, and what a reader would call it. */
export interface UninstallTarget {
  path: string;
  label: string;
}

/** Binaries the installer may have written, in the order it prefers them. */
function binaryPaths(homeDir: string): string[] {
  return [
    "/usr/local/bin/freecode",
    "/usr/bin/freecode",
    path.join(homeDir, ".local/bin/freecode"),
    path.join(homeDir, ".cargo/bin/freecode"),
  ];
}

/**
 * What `uninstall` would delete — pure, so the safety rule is testable without
 * deleting anything.
 *
 * The rule: **the program goes, the data stays.** `~/.freecode` is not an
 * install directory that happens to hold a binary; it is sessions, rollout
 * logs, per-project memory, prompt history and usage, and only `--purge` takes
 * those. This matches `scripts/uninstall.sh`, which has always drawn the line
 * here — the CLI was the copy that got it wrong.
 */
export function planUninstall(opts: {
  homeDir: string;
  configDir: string;
  purge: boolean;
  exists?: (p: string) => boolean;
}): UninstallTarget[] {
  const exists = opts.exists ?? ((p: string) => fs.existsSync(p));
  const targets: UninstallTarget[] = [];

  for (const binPath of binaryPaths(opts.homeDir)) {
    if (exists(binPath)) targets.push({ path: binPath, label: "launcher" });
  }

  if (opts.purge) {
    if (exists(opts.configDir)) {
      targets.push({
        path: opts.configDir,
        label: "ALL user data: sessions, rollout logs, memory, history, usage",
      });
    }
    return targets;
  }

  const builds = path.join(opts.configDir, "builds");
  if (exists(builds)) {
    targets.push({ path: builds, label: "installed binaries" });
  }
  return targets;
}

async function askConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export const uninstallCommand: CommandModule<object, UninstallArgs> = {
  command: "uninstall",
  describe: "remove the freecode binaries (user data is kept unless --purge)",
  builder: (yargs) =>
    yargs
      .option("force", {
        type: "boolean",
        default: false,
        describe: "skip confirmation prompt",
        alias: ["f", "y", "yes"],
      })
      .option("purge", {
        type: "boolean",
        default: false,
        describe: `also delete ${CONFIG_DIR} — sessions, memory, history, usage`,
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "print what would be removed, delete nothing",
      }),
  handler: async (argv) => {
    const { force, purge } = argv;
    const dryRun = argv["dry-run"];
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";

    if (!homeDir) {
      console.error("Error: Could not determine home directory");
      process.exit(1);
    }

    const targets = planUninstall({ homeDir, configDir: CONFIG_DIR, purge });

    if (targets.length === 0) {
      console.log("Nothing to uninstall: no freecode installation found.");
      process.exit(0);
    }

    console.log("\nThe following will be removed:");
    targets.forEach((t) => console.log(`  - ${t.path} (${t.label})`));
    if (!purge) {
      console.log(
        `\nUser data in ${CONFIG_DIR} is kept. Use --purge for a full wipe.`,
      );
    }

    if (dryRun) {
      console.log("\nDry run: nothing deleted.");
      process.exit(0);
    }

    if (!force) {
      // A piped stdin resolves the prompt instantly with an empty answer, which
      // would read as "no" — but silently, and only after the list scrolled by.
      // Say so instead.
      if (!process.stdin.isTTY) {
        console.error(
          "\nError: stdin is not a terminal; re-run with --force to skip the prompt.",
        );
        process.exit(1);
      }
      const confirmed = await askConfirmation("\nProceed?");
      if (!confirmed) {
        console.log("Uninstallation cancelled.");
        process.exit(0);
      }
    }

    const removed: string[] = [];
    const errors: Array<{ item: string; error: string }> = [];

    for (const { path: item } of targets) {
      try {
        if (fs.existsSync(item)) {
          fs.rmSync(item, { recursive: true, force: true });
          removed.push(item);
        }
      } catch (error) {
        errors.push({ item, error: (error as Error).message });
      }
    }

    console.log("\n✓ Successfully removed:");
    removed.forEach((item) => console.log(`  - ${item}`));

    if (errors.length > 0) {
      console.log("\n⚠ Failed to remove:");
      errors.forEach(({ item, error }) => console.log(`  - ${item}: ${error}`));
      process.exit(1);
    }

    console.log(
      purge
        ? "\n✓ FreeCode has been uninstalled and all data removed."
        : `\n✓ FreeCode has been uninstalled. Your data is still in ${CONFIG_DIR}.`,
    );
    process.exit(0);
  },
};
