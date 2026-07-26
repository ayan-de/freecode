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
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {},
};
