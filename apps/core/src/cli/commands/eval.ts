import type { CommandModule } from "yargs";

// `freecode eval` — run an eval suite against the real agent loop.
// Spec: docs/superpowers/specs/2026-08-23-eval-harness.md

interface EvalAddArgs {
  sessionId: string;
  turn?: number;
  suite: string;
  write: boolean;
}

interface EvalArgs {
  suite: string;
  trials?: number;
  model?: string;
  gate: boolean;
  json: boolean;
  quarantineReport: boolean;
  save?: string;
  compare?: string;
  stuck: boolean;
  otlp?: string;
  acceptBaseline: boolean;
}

const dim = "\x1b[2m";
const red = "\x1b[31m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

// `freecode eval add <session-id>` — harvest a real session into a draft case.
//
// Emits to STDOUT and guidance to STDERR, so `... >> evals/trajectory.jsonl`
// works and leaves the notes on the terminal where a human will read them.
// `--write` does the append itself, validating the whole file afterwards.
const evalAddCommand: CommandModule<object, EvalAddArgs> = {
  command: "add <session-id>",
  describe: "Harvest a draft eval case from a recorded session",
  builder: (yargs) =>
    yargs
      .positional("sessionId", {
        type: "string",
        demandOption: true,
        describe: "session id, as shown by `freecode session list`",
      })
      .option("turn", {
        type: "number",
        describe: "1-based user turn to harvest (default: the last one)",
      })
      .option("suite", {
        type: "string",
        default: "trajectory",
        describe: "suite to append to with --write",
      })
      .option("write", {
        type: "boolean",
        default: false,
        describe: "append to the suite file instead of printing to stdout",
      }),
  handler: async (argv) => {
    const { harvestCase, formatCase, HarvestError } =
      await import("../../eval/harvest.js");
    const { loadSessionEvents } = await import("../../rollout/history.js");
    const { parseSuite, suitePath } = await import("../../eval/dataset.js");

    try {
      // A harvested session carries no `files` fixture, so there is nothing for
      // a `verify` to run against — the case would load, then fail every run.
      if (argv.suite === "coding") {
        throw new HarvestError(
          "cannot harvest into the coding suite: a recorded session has no " +
            "`files` fixture, so `verify` would have nothing to run against. " +
            "Harvest into a trajectory suite, or write the coding case by hand.",
        );
      }

      const recorded = loadSessionEvents(argv.sessionId);
      if (!recorded) {
        throw new HarvestError(
          `no rollout log for session ${argv.sessionId}. ` +
            `Check the id with \`freecode session list\`.`,
        );
      }

      const { createSessionStore } = await import("../../session/store.js");
      const os = await import("os");
      const path = await import("path");
      const store = await createSessionStore(
        path.join(os.homedir(), ".freecode"),
      );
      const messages = await store.getMessages(argv.sessionId);

      const result = harvestCase({
        sessionId: argv.sessionId,
        messages,
        events: recorded.events,
        turn: argv.turn,
      });
      const line = formatCase(result.kase);

      // Validate the draft the same way a suite load would, so this command
      // can never emit something `freecode eval` would then reject.
      parseSuite(line, "<draft>");

      console.error(
        `${dim}harvested turn ${result.turn} of ${result.turnCount} from ${argv.sessionId}${reset}`,
      );
      for (const note of result.notes) {
        console.error(`${yellow}note${reset} ${note}`);
      }

      if (!argv.write) {
        console.log(line);
        console.error(
          `\n${dim}append it with: freecode eval add ${argv.sessionId} --write${reset}`,
        );
        return;
      }

      const fs = await import("fs");
      const file = suitePath(argv.suite);
      if (!fs.existsSync(file)) {
        throw new HarvestError(`no such suite: ${file}`);
      }
      const existing = fs.readFileSync(file, "utf-8");
      const appended =
        existing.endsWith("\n") || existing === ""
          ? `${existing}${line}\n`
          : `${existing}\n${line}\n`;
      // Validate the WHOLE file before writing: a duplicate id is only
      // visible against the rest of the suite, and discovering it on the next
      // `freecode eval` would mean a broken suite committed in between.
      parseSuite(appended, file);
      fs.writeFileSync(file, appended, "utf-8");
      console.error(`${green}appended${reset} ${result.kase.id} to ${file}`);
    } catch (err) {
      console.error(`${red}${(err as Error).message}${reset}`);
      process.exit(1);
    }
  },
};

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
      // No default: "not given" has to be distinguishable from "given as 1",
      // so --gate can raise it without overriding an explicit choice.
      .option("trials", {
        type: "number",
        describe:
          "runs per case (default 1, or 3 under --gate for majority-of-3)",
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
      })
      .option("otlp", {
        type: "string",
        describe:
          "ship the scores to an OTLP collector, linked to the traces they graded " +
          "(empty uses OTEL_EXPORTER_OTLP_ENDPOINT)",
      })
      // Declared camelCase; yargs accepts `--accept-baseline` either way.
      .option("acceptBaseline", {
        type: "boolean",
        default: false,
        describe:
          "record this run as the baseline even if it fails — for when the " +
          "suite was deliberately re-scoped, not when the agent got worse",
      })
      .command(evalAddCommand),
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

    // `--gate` with one trial is pass@1 — the statistic §9.1 argues is too
    // noisy to block on, which made the gate's own default contradict its
    // design. An explicit `--trials 1` is still honoured: someone asking for a
    // cheap smoke run under --gate knows what they are getting.
    const trials = argv.trials ?? (argv.gate ? 3 : 1);
    if (argv.gate && argv.trials === 1) {
      console.error(
        `${yellow}--gate with --trials 1 is pass@1; majority-of-N needs 3.${reset}`,
      );
    }

    try {
      const { report, verdict, accepted } = await runSuite({
        suite: argv.suite,
        trials,
        model: argv.model,
        acceptBaseline: argv.acceptBaseline,
        onCase: (result) => {
          if (argv.json) return;
          const mark = result.passed
            ? `${green}PASS${reset}`
            : `${red}FAIL${reset}`;
          const tag = result.quarantined
            ? ` ${yellow}[quarantined]${reset}`
            : "";
          // A judged case shows its score even when it passed — the number IS
          // the result there, and "PASS" alone hides a 2.0 scraping the floor.
          const why =
            result.score !== undefined || !result.passed
              ? ` ${dim}${result.trials[0]?.reason}${reset}`
              : "";
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
        const { summarise: summariseMetrics } =
          await import("../../eval/compare.js");
        const { formatUsd, PRICES_AS_OF } =
          await import("../../providers/pricing.js");
        // Disclosure (spec §7): the same-model check compares normalised ids
        // and cannot see through a gateway route, so print who actually graded.
        const scored = report.cases.filter(
          (c) => typeof c.score === "number",
        ) as Array<{ id: string; score: number }>;
        if (scored.length > 0) {
          const mean =
            scored.reduce((n, c) => n + c.score, 0) / scored.length;
          console.log(
            `${dim}judged mean ${mean.toFixed(2)}/5 over ${scored.length} case(s) ` +
              `· judge ${report.judge?.provider}/${report.judge?.model ?? "<default>"}${reset}`,
          );
        }
        // No `else if (report.judgeSkipped)` branch: an unconfigured judge is
        // now a gate reason, printed in red with the rest of them below. Saying
        // it twice, once in yellow, was how it read as advisory.

        const metrics = summariseMetrics(report);
        if (metrics.costUsd !== undefined) {
          console.log(
            `${dim}${formatUsd({ usd: metrics.costUsd, partial: false })} estimated ` +
              `· ${metrics.tokens.toLocaleString()} tokens ` +
              `· prices as of ${PRICES_AS_OF}${reset}`,
          );
        }
        const { formatEfficiency, suiteEfficiency } =
          await import("../../eval/scorers/efficiency.js");
        const perTrial = formatEfficiency(suiteEfficiency(report));
        if (perTrial) console.log(`${dim}${perTrial}${reset}`);

        for (const reason of verdict.reasons) {
          console.log(`${verdict.open ? dim : red}${reason}${reset}`);
        }
        // Yellow, and never counted in the gate line below: §9.2 makes this
        // warn-only because the number moves when the SUITE changes as readily
        // as when the agent does, and nothing here can tell those apart.
        for (const warning of verdict.warnings) {
          console.log(`${yellow}${warning}${reset}`);
        }
        if (accepted) {
          // Loud on purpose. This is someone overriding a red gate, and the
          // difference between "the suite was re-scoped" and "the agent got
          // worse" is invisible from here — only the person typing it knows.
          console.log(
            `${yellow}BASELINE ACCEPTED${reset} — recorded ${report.passed}/${report.total} ` +
              `as the new baseline despite the failure(s) above.\n` +
              `${dim}Future runs are measured against this. If the agent got worse ` +
              `rather than the suite getting smaller, this just hid it.${reset}`,
          );
        } else if (argv.acceptBaseline) {
          console.log(
            `${dim}--accept-baseline had nothing to do: the gate is open, so ` +
              `this run becomes the baseline anyway.${reset}`,
          );
        }
        if (argv.gate) {
          console.log(
            verdict.open
              ? `${green}GATE OPEN${reset} — safe to release.`
              : accepted
                ? `${yellow}GATE CLOSED, accepted${reset} — exiting 0 by request.`
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
            // A USD row rendered with the integer formatter reads `0` for
            // every run under a dollar, which is every run.
            const show = (n: number) =>
              row.unit === "usd" ? `$${n.toFixed(4)}` : String(n);
            console.log(
              `  ${mark} ${row.metric.padEnd(20)} ${show(row.baseline).padStart(10)} → ${show(row.candidate).padStart(10)}  ${dim}${sign}${show(row.delta)}${reset}`,
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

      if (argv.otlp !== undefined) {
        const { otlpTargetFromEnv } = await import("../../rollout/otlp.js");
        const target =
          argv.otlp.length > 0 ? { endpoint: argv.otlp } : otlpTargetFromEnv();
        if (!target) {
          console.error(
            `${red}No OTLP endpoint. Pass --otlp <url> or set OTEL_EXPORTER_OTLP_ENDPOINT.${reset}`,
          );
        } else {
          const { exportReport } = await import("../../eval/otlp.js");
          // A collector being down must not turn a green suite red — the run
          // already happened and the report is already on disk.
          try {
            await exportReport(report, target);
            console.log(`${dim}exported scores to ${target.endpoint}${reset}`);
          } catch (err) {
            console.error(
              `${yellow}OTLP export failed: ${(err as Error).message}${reset}`,
            );
          }
        }
      }

      // Accepting the baseline is accepting the result, so it exits 0 — that
      // is the entire point of the flag, and a non-zero exit would leave CI red
      // on a run the operator explicitly signed off.
      if (argv.gate && !verdict.open && !accepted) process.exit(1);
    } catch (err) {
      console.error(`${red}${(err as Error).message}${reset}`);
      process.exit(1);
    }
  },
};
