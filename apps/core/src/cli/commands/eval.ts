import type { CommandModule } from "yargs";

// `freecode eval` — run an eval suite against the real agent loop.
// Spec: docs/superpowers/specs/2026-08-23-eval-harness.md

interface EvalArgs {
  suite: string;
  trials: number;
  model?: string;
  gate: boolean;
  json: boolean;
  quarantineReport: boolean;
}

const dim = "\x1b[2m";
const red = "\x1b[31m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

export const evalCommand: CommandModule<object, EvalArgs> = {
  command: "eval [suite]",
  describe: "Run an eval suite against the agent loop",
  builder: (yargs) =>
    yargs
      .positional("suite", {
        type: "string",
        default: "trajectory",
        describe: "suite name, resolved as evals/<suite>.jsonl",
      })
      .option("trials", {
        type: "number",
        default: 1,
        describe: "runs per case; 3 enables majority-of-3 gating",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "provider/model override for cases that don't pin one",
      })
      .option("gate", {
        type: "boolean",
        default: false,
        describe: "exit 1 on regression against the recorded baseline",
      })
      .option("json", { type: "boolean", default: false })
      // Declared camelCase; yargs' camel-case expansion accepts
      // `--quarantine-report` on the command line either way.
      .option("quarantineReport", {
        type: "boolean",
        default: false,
        describe: "print quarantine promotion/demotion proposals and exit",
      }),
  handler: async (argv) => {
    const { runSuite } = await import("../../eval/suite.js");
    const { loadQuarantine, proposeQuarantine } = await import(
      "../../eval/quarantine.js"
    );
    const { readHistory } = await import("../../eval/report.js");

    if (argv.quarantineReport) {
      const history = readHistory(argv.suite).map((r) => r.cases);
      const report = proposeQuarantine(history, loadQuarantine());
      if (report.thin) {
        console.log(
          `${yellow}Only ${history.length} recorded runs — rates are advisory.${reset}\n`,
        );
      }
      for (const p of report.toQuarantine) {
        console.log(
          `${yellow}quarantine${reset} ${p.id} ${dim}(${(p.rate * 100).toFixed(0)}% over ${p.runs} trials)${reset}`,
        );
      }
      for (const p of report.toRelease) {
        console.log(
          `${green}release${reset}    ${p.id} ${dim}(${(p.rate * 100).toFixed(0)}% over ${p.runs} trials)${reset}`,
        );
      }
      if (!report.toQuarantine.length && !report.toRelease.length) {
        console.log("No quarantine changes proposed.");
      }
      return;
    }

    try {
      const { report, verdict } = await runSuite({
        suite: argv.suite,
        trials: argv.trials,
        model: argv.model,
        onCase: (result) => {
          if (argv.json) return;
          const mark = result.passed ? `${green}PASS${reset}` : `${red}FAIL${reset}`;
          const tag = result.quarantined ? ` ${yellow}[quarantined]${reset}` : "";
          const why = result.passed ? "" : ` ${dim}${result.trials[0]?.reason}${reset}`;
          const flaky =
            result.passed && !result.consistent ? ` ${yellow}(flaky)${reset}` : "";
          console.log(`${mark} ${result.id}${tag}${flaky}${why}`);
        },
      });

      if (argv.json) {
        console.log(JSON.stringify({ report, verdict }, null, 2));
      } else {
        console.log(
          `\n${report.passed}/${report.total} cases passed ` +
            `${dim}(${report.trials} trial${report.trials === 1 ? "" : "s"} each)${reset}`,
        );
        for (const reason of verdict.reasons) {
          console.log(`${verdict.open ? dim : red}${reason}${reset}`);
        }
        if (argv.gate) {
          console.log(
            verdict.open
              ? `${green}GATE OPEN${reset} — safe to release.`
              : `${red}GATE CLOSED${reset}`,
          );
        }
      }

      if (argv.gate && !verdict.open) process.exit(1);
    } catch (err) {
      console.error(`${red}${(err as Error).message}${reset}`);
      process.exit(1);
    }
  },
};
