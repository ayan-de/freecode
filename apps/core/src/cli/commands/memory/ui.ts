import type { CommandModule } from "yargs";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { resolveVersion } from "../../create-cli.js";
import { addonDir } from "../../../graph-explorer/server.js";

// =============================================================================
// `freecode memory ui-install` / `ui-uninstall`
//
// Optional addon: a small static-asset bundle (index.html, graph.js, graph.css,
// d3.min.js) downloaded once from the same GitHub release as the running
// binary and extracted into ~/.freecode/addons/graph-ui/. The server checks
// this directory at request time, so a fresh install is picked up the very
// next time the user runs /graph — no daemon restart required.
//
// Nothing about the install path is duplicated elsewhere in freecode, so
// `ui-uninstall` is simply `rm -rf addonDir()` — fully reversible.
// =============================================================================

const REPO = "ayan-de/freecode";

// Where the addon lives, mirrored from graph-explorer/server.ts so uninstall
// removes exactly what install created (and nothing else).
const ADDON_DIR = addonDir();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Download graph-ui.tar.gz + SHA256SUMS for the running freecode version,
// verify the archive's hash, and extract it into ~/.freecode/addons/graph-ui/.
// Throws on any failure with a user-readable message.
async function install(version: string): Promise<void> {
  const tag = version.startsWith("v") ? version : `v${version}`;
  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  const archiveName = "graph-ui.tar.gz";

  process.stdout.write(`  Fetching ${archiveName} for ${tag}…\n`);
  const [archive, sums] = await Promise.all([
    fetchBuffer(`${base}/${archiveName}`),
    fetchBuffer(`${base}/SHA256SUMS`).then((b) => b.toString("utf-8")),
  ]);

  // Parse `sha256-name` (one line, sha256 first, then two spaces, then name —
  // matches `sha256sum` output). Match by basename so the line order doesn't
  // matter.
  const expected = (() => {
    for (const raw of sums.split("\n")) {
      const m = raw.trim().match(/^([0-9a-f]{64})\s+(.+)$/i);
      if (!m) continue;
      const baseName = path.basename(m[2].trim());
      if (baseName === archiveName) return m[1].toLowerCase();
    }
    return null;
  })();
  const actual = createHash("sha256").update(archive).digest("hex");
  if (!expected) {
    throw new Error(
      `SHA256SUMS did not list ${archiveName} for ${tag}; release may not include the addon`,
    );
  }
  if (expected !== actual) {
    throw new Error(
      `sha256 mismatch for ${archiveName}: expected ${expected}, got ${actual}`,
    );
  }

  // Atomic install: extract into a tmpdir, then rename into place. Avoids
  // leaving the addon in a half-extracted state if tar fails mid-flight.
  const tmpExtract = fs.mkdtempSync(
    path.join(os.tmpdir(), "freecode-graph-ui-"),
  );
  try {
    fs.writeFileSync(path.join(tmpExtract, archiveName), archive);
    execFileSync("tar", ["-xzf", archiveName], { cwd: tmpExtract });
    fs.rmSync(path.join(tmpExtract, archiveName), { force: true });

    fs.mkdirSync(path.dirname(ADDON_DIR), { recursive: true });
    // Replace any existing install in one swap — old dir goes to a trash dir
    // we delete after the new one is in place, so `ui-install` is idempotent.
    const trash = fs.mkdtempSync(
      path.join(os.tmpdir(), "freecode-graph-ui-old-"),
    );
    if (fs.existsSync(ADDON_DIR)) {
      fs.renameSync(ADDON_DIR, path.join(trash, "graph-ui"));
    }
    fs.renameSync(tmpExtract, ADDON_DIR);
    fs.rmSync(trash, { recursive: true, force: true });
  } catch (e) {
    fs.rmSync(tmpExtract, { recursive: true, force: true });
    throw e;
  }

  // Sanity-check the result: index.html must exist or the server won't serve
  // anything. Tells the user something is wrong (corrupt archive?) instead of
  // silently producing a /graph that says "not-installed".
  if (!fs.existsSync(path.join(ADDON_DIR, "index.html"))) {
    throw new Error(
      `extraction did not produce index.html under ${ADDON_DIR}`,
    );
  }
}

// Helper that keeps the Buffer-typed fetch above readable.
function archiveBytes(archive: Buffer): Buffer {
  return archive;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

interface UiArgs {
  version?: string;
}

function versionOption(yargs: import("yargs").Argv) {
  return yargs.option("version", {
    type: "string",
    describe:
      "Override the addon version (defaults to the running freecode --version)",
  });
}

const uiInstallCommand: CommandModule<object, UiArgs> = {
  command: "ui-install",
  describe:
    "Download the graph explorer UI addon (~280 KB) into ~/.freecode/addons/graph-ui/",
  builder: versionOption,
  handler: async (argv) => {
    const version = argv.version || resolveVersion();
    if (version === "unknown") {
      process.stderr.write(
        "  Could not determine the running freecode version; pass --version vX.Y.Z explicitly.\n",
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`  Installing graph UI for freecode ${version}…\n`);
    try {
      await install(version);
      process.stdout.write(`  Done. Run /graph in the TUI to open it.\n`);
      process.stdout.write(`    (or: ${ADDON_DIR})\n`);
    } catch (e) {
      process.stderr.write(`  Install failed: ${(e as Error).message}\n`);
      process.exitCode = 1;
    }
  },
};

const uiUninstallCommand: CommandModule<object, UiArgs> = {
  command: "ui-uninstall",
  describe: "Remove the graph explorer UI addon from ~/.freecode/addons/graph-ui/",
  builder: (yargs) => yargs,
  handler: async () => {
    if (!fs.existsSync(ADDON_DIR)) {
      process.stdout.write(`  Nothing to uninstall at ${ADDON_DIR}\n`);
      return;
    }
    fs.rmSync(ADDON_DIR, { recursive: true, force: true });
    process.stdout.write(`  Removed ${ADDON_DIR}\n`);
  },
};

export const uiCommand: CommandModule = {
  command: "ui",
  describe: "Manage the optional graph explorer UI addon",
  builder: (yargs) =>
    yargs
      .command(uiInstallCommand)
      .command(uiUninstallCommand)
      .demandCommand(1, "Specify a subcommand (ui-install or ui-uninstall)"),
  handler: () => {},
};