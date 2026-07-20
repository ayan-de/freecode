import type { CommandModule } from "yargs";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { execSync } from "child_process";

interface UninstallArgs {
  force: boolean;
}

async function askConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/n) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

export const uninstallCommand: CommandModule<object, UninstallArgs> = {
  command: "uninstall",
  describe: "uninstall freecode and remove all related files",
  builder: (yargs) =>
    yargs.option("force", {
      type: "boolean",
      default: false,
      describe: "skip confirmation prompt",
      alias: "f",
    }),
  handler: async (argv) => {
    const { force } = argv;
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";

    if (!homeDir) {
      console.error("Error: Could not determine home directory");
      process.exit(1);
    }

    const freecodePath = path.join(homeDir, ".freecode");
    const itemsToRemove = [freecodePath];

    // Check for binary in common locations
    const binPaths = [
      "/usr/local/bin/freecode",
      "/usr/bin/freecode",
      path.join(homeDir, ".local/bin/freecode"),
      path.join(homeDir, ".cargo/bin/freecode"),
    ];

    for (const binPath of binPaths) {
      try {
        if (fs.existsSync(binPath)) {
          itemsToRemove.push(binPath);
        }
      } catch {
        // ignore
      }
    }

    // Show what will be removed
    console.log("\nThe following will be removed:");
    itemsToRemove.forEach((item) => console.log(`  - ${item}`));

    if (!force) {
      const confirmed = await askConfirmation(
        "\nProceed with uninstallation?",
      );
      if (!confirmed) {
        console.log("Uninstallation cancelled.");
        process.exit(0);
      }
    }

    // Remove items
    let removed: string[] = [];
    let errors: Array<{ item: string; error: string }> = [];

    for (const item of itemsToRemove) {
      try {
        if (fs.existsSync(item)) {
          const stat = fs.statSync(item);
          if (stat.isDirectory()) {
            fs.rmSync(item, { recursive: true, force: true });
          } else {
            fs.unlinkSync(item);
          }
          removed.push(item);
        }
      } catch (error: any) {
        errors.push({ item, error: error.message });
      }
    }

    // Report results
    console.log("\n✓ Successfully removed:");
    removed.forEach((item) => console.log(`  - ${item}`));

    if (errors.length > 0) {
      console.log("\n⚠ Failed to remove:");
      errors.forEach(({ item, error }) =>
        console.log(`  - ${item}: ${error}`),
      );
      process.exit(1);
    }

    console.log("\n✓ FreeCode has been uninstalled.");
    process.exit(0);
  },
};
