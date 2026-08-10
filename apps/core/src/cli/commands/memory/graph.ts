import type { CommandModule } from "yargs";
import { getMemoryGraphService } from "../../../memory/index.js";
import { getMemoryStore } from "../../../memory/mem-store.js";
import {
  garden,
  DEFAULT_HALF_LIFE_DAYS,
} from "../../../memory/graph/garden.js";

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

// Proposals only — this command never edits or deletes a memory. Consolidation
// logic gets used attended, by a human reading its output, before anything
// unattended is ever trusted to call it (autonomous-runs spec §4.6).
const gardenCommand: CommandModule<
  object,
  GraphArgs & { "half-life"?: number; threshold?: number }
> = {
  command: "garden",
  describe: "Propose memory consolidations (duplicates, stale entries) — never writes",
  builder: (yargs) =>
    projectOption(yargs)
      .option("half-life", {
        type: "number",
        default: DEFAULT_HALF_LIFE_DAYS,
        describe: "Days without an update before a memory is flagged stale",
      })
      .option("threshold", {
        type: "number",
        default: 0.95,
        describe: "Similarity (0-1) at or above which two memories pair as duplicates",
      }),
  handler: async (argv) => {
    const projectPath = argv.project || process.cwd();
    const store = getMemoryStore(projectPath);
    const entries = store.list();
    const result = garden(entries, {
      duplicateThreshold: argv.threshold,
      halfLifeDays: argv["half-life"],
    });

    console.log(`\n  ${yellow}Memory garden${reset}  (${entries.length} memories, nothing was changed)`);

    if (result.duplicates.length === 0) {
      console.log("    duplicates: none");
    } else {
      console.log(`    duplicates: ${result.duplicates.length}`);
      for (const pair of result.duplicates) {
        console.log(
          `      keep ${pair.keep.type}/${pair.keep.name}  ·  drop ${pair.drop.type}/${pair.drop.name}  (${(pair.similarity * 100).toFixed(0)}% similar)`,
        );
      }
    }

    if (result.stale.length === 0) {
      console.log("    stale:      none\n");
      return;
    }
    console.log(`    stale:      ${result.stale.length} (untouched >${argv["half-life"]}d)`);
    for (const entry of result.stale) {
      const days = Math.floor((Date.now() - entry.updatedAt) / 86_400_000);
      console.log(`      ${entry.type}/${entry.name}  (${days}d)`);
    }
    // No --apply and no delete command to point at on purpose: acting on a
    // proposal is a human decision, and an old memory is often still true.
    console.log(`\n  Review these yourself. Files live in ${store.getMemoryDir()}\n`);
  },
};

export const graphCommand: CommandModule = {
  command: "graph",
  describe: "Inspect and maintain the derived memory knowledge graph",
  builder: (yargs) =>
    yargs
      .command(rebuildCommand)
      .command(statsCommand)
      .command(gardenCommand)
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {},
};
