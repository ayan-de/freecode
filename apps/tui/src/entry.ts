#!/usr/bin/env node
// =============================================================================
// entry.ts — single-binary dispatcher
//
// The distributed `freecode` binary (bun --compile) bundles BOTH the TUI shell
// and the core backend. This entry decides which half to run:
//   freecode __core     → run the JSON-RPC backend (spawned by the TUI itself)
//   freecode --version  → print the baked build version and exit
//   freecode update     → re-run the web installer to fetch the latest release
//   freecode [...]       → run the interactive TUI (default)
//
// In dev (`tsx src/index.ts`) the TUI is launched directly and this file is not
// on the hot path; it only matters for the compiled binary.
// =============================================================================

const argv = process.argv.slice(2);

async function main(): Promise<void> {
  // Backend mode: the TUI re-execs this same binary with `__core` so the
  // whole app is self-contained (no external apps/core/dist needed).
  if (argv.includes("__core")) {
    // @ts-ignore — resolved by the bundler at compile time / by node at runtime
    const core = await import("@thisisayande/freecode-core");
    await core.startServer();
    return;
  }

  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    process.stdout.write(
      (process.env.FREECODE_BUILD_VERSION ?? "unknown") + "\n",
    );
    return;
  }

  // Core CLI subcommands (yargs): importing cli.js runs it on process.argv.
  if (argv[0] === "mcp" || argv[0] === "session" || argv[0] === "web") {
    // @ts-ignore — resolved by the bundler at compile time / by node at runtime
    await import("@thisisayande/freecode-core/cli");
    return;
  }

  if (argv[0] === "update") {
    const { spawnSync } = await import("child_process");
    const cmd = "curl -fsSL https://freecode.ayande.xyz/install | bash";
    process.stderr.write(`[freecode] updating: ${cmd}\n`);
    const r = spawnSync("bash", ["-c", cmd], { stdio: "inherit" });
    process.exit(r.status ?? 0);
  }

  // Default: launch the TUI. Importing runs it (index.ts calls tui.start()).
  await import("./index.js");
}

main().catch((e) => {
  process.stderr.write(`[freecode] fatal: ${e instanceof Error ? e.stack : e}\n`);
  process.exit(1);
});
