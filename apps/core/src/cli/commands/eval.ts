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
  save?: string;
  compare?: string;
  stuck: boolean;
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
      })
      .option("save", {
        type: "string",
        describe: "write this run's report to a file, for a later --compare",
      })
      .option("compare", {
        type: "string",
        describe: "compare this run against a saved report (the baseline)",
      })
      .option("stuck", {
        type: "boolean",
        default: false,
        describe:
          "treat this as a stuck-loop suite: --compare also requires repetition to fall",
      }),
  handler: async (argv) => {
    const { runSuite } = await import("../../eval/suite.js");
    const { loadQuarantine, proposeQuarantine } =
      await import("../../eval/quarantine.js");
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
          const mark = result.passed
            ? `${green}PASS${reset}`
            : `${red}FAIL${reset}`;
          const tag = result.quarantined
            ? ` ${yellow}[quarantined]${reset}`
            : "";
          const why = result.passed
            ? ""
            : ` ${dim}${result.trials[0]?.reason}${reset}`;
          const flaky =
            result.passed && !result.consistent
              ? ` ${yellow}(flaky)${reset}`
              : "";
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

      if (argv.save) {
        const { writeFileSync } = await import("fs");
        writeFileSync(argv.save, JSON.stringify(report, null, 2), "utf-8");
        if (!argv.json)
          console.log(`${dim}saved report to ${argv.save}${reset}`);
      }

      if (argv.compare) {
        const { readFileSync } = await import("fs");
        const { compareReports } = await import("../../eval/compare.js");
        const baseline = JSON.parse(
          readFileSync(argv.compare, "utf-8"),
        ) as typeof report;
        const comparison = compareReports(baseline, report, {
          stuck: argv.stuck,
        });

        if (argv.json) {
          console.log(JSON.stringify(comparison, null, 2));
        } else {
          console.log(`\n${dim}baseline ${argv.compare}${reset}`);
          for (const row of comparison.rows) {
            const mark =
              row.ok === undefined
                ? `${dim}·${reset}`
                : row.ok
                  ? `${green}✓${reset}`
                  : `${red}✗${reset}`;
            const sign = row.delta > 0 ? "+" : "";
            console.log(
              `  ${mark} ${row.metric.padEnd(20)} ${String(row.baseline).padStart(10)} → ${String(row.candidate).padStart(10)}  ${dim}${sign}${row.delta}${reset}`,
            );
          }
          for (const reason of comparison.reasons) {
            console.log(`${red}${reason}${reset}`);
          }
          console.log(
            comparison.flip
              ? `${green}CRITERION MET${reset} — the candidate earned the change.`
              : `${red}CRITERION NOT MET${reset} — keep the default as it is.`,
          );
        }
        if (!comparison.flip) process.exit(1);
      }

      if (argv.gate && !verdict.open) process.exit(1);
    } catch (err) {
      console.error(`${red}${(err as Error).message}${reset}`);
      process.exit(1);
    }
  },
};
