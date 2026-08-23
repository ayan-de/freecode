import type { CommandModule } from "yargs";
import { getMemoryGraphService } from "../../../memory/index.js";

const yellow = "\x1b[33m";
const reset = "\x1b[0m";

interface GraphArgs {
  project?: string;
}

function projectOption(yargs: import("yargs").Argv) {
  return yargs.option("project", {
    type: "string",
    describe: "Project path (defaults to cwd)",
  });
}

function printStats(
  stats: ReturnType<ReturnType<typeof getMemoryGraphService>["stats"]>,
): void {
  console.log(`\n  ${yellow}Memory graph${reset}`);
  console.log(`    vectors:  ${stats.vectors} (${stats.dims}-dim)`);
  console.log(`    nodes:    ${stats.nodes}`);
  console.log(`    edges:    ${stats.edges}`);
  console.log(`    clusters: ${stats.clusters}`);
  console.log(`    embedder: ${stats.embedder ? "available" : "unavailable (keyword fallback)"}\n`);
}

// `memory graph usage` — the payoff of the citation loop (spec D12) made
// visible. useCount/injectedCount is a per-memory precision estimate: a memory
// surfaced twenty times and never cited is dead weight the consolidator should
// see, and this is the only place a human can read that today.
const usageCommand: CommandModule<object, GraphArgs> = {
  command: "usage",
  describe: "Show how often each memory was surfaced and actually used",
  builder: projectOption,
  handler: async (argv) => {
    const service = getMemoryGraphService(argv.project || process.cwd());
    const rows = [...service.allUsage().entries()].sort(
      (a, b) => b[1].injectedCount - a[1].injectedCount,
    );

    if (rows.length === 0) {
      console.log(
        "\n  No usage recorded yet. Counters accumulate as memories are" +
          "\n  surfaced and cited; they live in .graph/usage.json and are safe" +
          "\n  to delete.\n",
      );
      return;
    }

    console.log(`\n  ${yellow}Memory usage${reset}`);
    console.log("    used/shown  last used   memory");
    for (const [id, u] of rows) {
      const ratio = `${u.useCount}/${u.injectedCount}`.padEnd(11);
      const last =
        u.lastUsedAt === 0
          ? "never     "
          : new Date(u.lastUsedAt).toISOString().slice(0, 10);
      console.log(`    ${ratio} ${last}  ${id}`);
    }
    console.log("");
  },
};

const rebuildCommand: CommandModule<object, GraphArgs> = {
  command: "rebuild",
  describe: "Rebuild the derived memory index (vectors + graph) from files",
  builder: projectOption,
  handler: async (argv) => {
    const service = getMemoryGraphService(argv.project || process.cwd());
    console.log("\n  Rebuilding memory graph from files…");
    await service.rebuild();
    printStats(service.stats());
  },
};

const statsCommand: CommandModule<object, GraphArgs> = {
  command: "stats",
  describe: "Show memory graph statistics",
  builder: projectOption,
  handler: async (argv) => {
    const service = getMemoryGraphService(argv.project || process.cwd());
    printStats(service.stats());
  },
};

export const graphCommand: CommandModule = {
  command: "graph",
  describe: "Inspect and maintain the derived memory knowledge graph",
  builder: (yargs) =>
    yargs
      .command(rebuildCommand)
      .command(statsCommand)
      .command(usageCommand)
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {},
};
