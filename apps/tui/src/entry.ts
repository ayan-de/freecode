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
import { createCli, resolveVersion } from "@thisisayande/freecode-core/cli/create-cli";
// @ts-ignore — resolved via core's package.json exports map
import { formatFatalError } from "@thisisayande/freecode-core/cli/format-fatal-error";
import type { CommandModule } from "yargs";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

// `bun build --compile` embeds the memory graph's onnxruntime native addon
// but not the shared library it dlopen()s at runtime (libonnxruntime.so.1 /
// .dylib — see build-bun.mjs, which ships it as a loose file next to this
// binary). The dynamic linker only reads LD_LIBRARY_PATH/DYLD_LIBRARY_PATH at
// process start, so setting it lazily right before the embedder needs it is
// too late — the whole process has to be re-exec'd with the variable already
// set. Do that once, here, before any real work starts; a sentinel env var
// stops this from looping. No-op on Windows (same-directory DLLs just work)
// and outside the compiled binary (dev's real .node file finds its sibling
// via its own RPATH, no help needed).
if (
  process.env.FREECODE_BUNDLED === "1" &&
  process.platform !== "win32" &&
  !process.env.__FREECODE_REEXECED
) {
  const libDir = path.dirname(process.execPath);
  const key = process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
  const existing = process.env[key];
  const env = {
    ...process.env,
    [key]: existing ? `${libDir}${path.delimiter}${existing}` : libDir,
    __FREECODE_REEXECED: "1",
  };
  const result = spawnSync(process.execPath, process.argv.slice(2), {
    stdio: "inherit",
    env,
  });
  process.exit(result.status ?? 1);
}

// Checked once per launch, only in the distributed binary — dev (tsx) has no
// release to compare against. Best-effort: any failure (offline, GitHub down,
// rate limit) just skips the check and opens the TUI on the current version.
async function checkForUpdate(): Promise<void> {
  if (process.env.FREECODE_BUNDLED !== "1" || process.env.__FREECODE_UPDATE_CHECKED) {
    return;
  }
  process.env.__FREECODE_UPDATE_CHECKED = "1";

  let latest: string;
  try {
    const res = await fetch(
      "https://api.github.com/repos/ayan-de/freecode/releases/latest",
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return;
    const data = (await res.json()) as { tag_name?: string };
    latest = (data.tag_name ?? "").replace(/^v/, "");
  } catch {
    return;
  }
  const current = resolveVersion();
  if (!latest || latest === current) return;

  process.stderr.write(`[freecode] updating ${current} → ${latest}\n`);
  const r = spawnSync("bash", ["-c", "curl -fsSL https://freecode.website/install | bash"], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    process.stderr.write(`[freecode] update failed, continuing on ${current}\n`);
    return;
  }

  // Re-exec so the TUI that opens is the newly installed binary, not the
  // one already loaded in this process's memory. Re-exec through the
  // installer's `stable` symlink rather than `process.execPath`: the kernel
  // resolves symlinks at exec time, so `process.execPath` is the concrete
  // path to the *old* version's binary file. Spawning that path again runs
  // the stale binary, and the user has to close the TUI and re-type
  // `freecode` to actually pick up the update. The `stable` symlink is
  // rewritten on every install to point at the version just unpacked.
  //
  // This has to be checked AFTER the installer runs (not before), because at
  // startup `stable` still points at the same version as `process.execPath`
  // — the installer is what rewrites it. Comparing pre-install would
  // conclude "no change" and re-exec the same old binary, leaving the TUI
  // showing the stale version and forcing the user to relaunch manually.
  const freecodeHome = process.env.FREECODE_HOME ?? path.join(process.env.HOME ?? "", ".freecode");
  const stable = path.join(freecodeHome, "builds", "stable", "freecode");
  let execTarget: string;
  if (
    process.env.FREECODE_BUNDLED === "1" &&
    fs.existsSync(stable) &&
    fs.realpathSync(stable) !== fs.realpathSync(process.execPath)
  ) {
    execTarget = stable;
  } else {
    // No bundled re-exec (dev) or `stable` still points at the version we
    // just ran from — the installer either failed or installed the same
    // version we already are. Either way, nothing to do: stay in this
    // process.
    return;
  }
  const result = spawnSync(execTarget, process.argv.slice(2), {
    stdio: "inherit",
    env: { ...process.env, __FREECODE_UPDATE_CHECKED: "1" },
  });
  process.exit(result.status ?? 0);
}

interface TuiArgs {
  project?: string;
  resume?: string;
}

const tuiCommand: CommandModule<object, TuiArgs> = {
  command: "$0 [project]",
  describe: "start the freecode TUI",
  builder: (yargs) =>
    yargs
      .positional("project", {
        describe: "project directory to open (defaults to current directory)",
        type: "string",
      })
      .option("resume", {
        alias: "r",
        // string with no value (`--resume`) opens the session picker; with an id
        // it resumes directly. index.ts reads this back off process.argv.
        describe: "resume a previous session by id (omit id to pick from a list)",
        type: "string",
      }),
  handler: async (argv) => {
    // Change to the specified project directory if provided
    if (argv.project) {
      const projectPath = path.resolve(argv.project);
      try {
        fs.accessSync(projectPath);
        process.chdir(projectPath);
      } catch {
        process.stderr.write(
          `[freecode] error: project directory not found: ${argv.project}\n`,
        );
        process.exit(1);
      }
    }

    await checkForUpdate();

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
    const cmd = "curl -fsSL https://freecode.website/install | bash";
    process.stderr.write(`[freecode] updating: ${cmd}\n`);
    const r = spawnSync("bash", ["-c", cmd], { stdio: "inherit" });
    process.exit(r.status ?? 0);
  },
};

// Background work (retries, fallback providers) can reject after the TUI's
// own awaited chain has resolved. Left unhandled, Bun's default reporter
// dumps the raw error object (every AI SDK field plus minified stack
// context); keep it on the same clean one-liner as the awaited failure.
process.on("unhandledRejection", (e) => {
  process.stderr.write(`[freecode] fatal: ${formatFatalError(e)}\n`);
});

createCli([tuiCommand, updateCommand])
  .parseAsync()
  .catch((e: unknown) => {
    process.stderr.write(`[freecode] fatal: ${formatFatalError(e)}\n`);
    process.exit(1);
  });
