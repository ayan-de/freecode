// =============================================================================
// `freecode trace` — read the rollout log as a timeline.
//
// Answers "why is this session slow / why is it stuck" from the event log
// alone, with no live process to attach to. `--follow` does the same against
// a run that is still going, which is the only way to watch a hang happen.
// =============================================================================

import type { CommandModule } from "yargs";
import * as fs from "fs";
import {
  getEventsFilePath,
  listRecordedSessions,
  loadSessionEvents,
} from "../../rollout/history.js";
import { buildTrace } from "../../rollout/trace.js";
import { formatDuration, renderTrace } from "../../rollout/trace-render.js";
import { exportTrace, otlpTargetFromEnv } from "../../rollout/otlp.js";

/** Most recently written session, which is nearly always the one in question. */
function latestSessionId(): string | undefined {
  return listRecordedSessions()
    .map((id) => {
      try {
        return { id, mtime: fs.statSync(getEventsFilePath(id)).mtimeMs };
      } catch {
        return { id, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime)[0]?.id;
}

function render(sessionId: string, argv: TraceArgs, now?: number): string {
  const loaded = loadSessionEvents(sessionId);
  if (!loaded) return `No recorded events for session ${sessionId}`;
  const trace = buildTrace(sessionId, loaded.events, now);
  if (argv.json) return JSON.stringify(trace, null, 2);
  return renderTrace(trace, {
    slowerThanMs: argv.slow,
    showTools: argv.tools,
  });
}

interface TraceArgs {
  sessionId?: string;
  follow?: boolean;
  slow?: number;
  tools?: boolean;
  json?: boolean;
  list?: boolean;
  otlp?: string;
}

export const traceCommand: CommandModule<object, TraceArgs> = {
  command: "trace [sessionId]",
  describe: "Show where a session's time went (model calls, tools, hangs)",
  builder: (yargs) =>
    yargs
      .positional("sessionId", {
        describe: "Session to trace (defaults to the most recent)",
        type: "string",
      })
      .option("follow", {
        alias: "f",
        type: "boolean",
        describe: "Re-render as the session runs",
      })
      .option("slow", {
        type: "number",
        describe: "Only show model calls slower than N ms",
      })
      .option("tools", {
        type: "boolean",
        default: true,
        describe: "Include tool calls in the waterfall",
      })
      .option("json", {
        type: "boolean",
        describe: "Emit the assembled trace as JSON",
      })
      .option("list", {
        type: "boolean",
        describe: "List recorded sessions instead of tracing one",
      })
      .option("otlp", {
        type: "string",
        describe:
          "Ship the trace to an OTLP collector (Langfuse, Phoenix, Jaeger). " +
          "Defaults to $OTEL_EXPORTER_OTLP_ENDPOINT",
      }),

  handler: async (argv) => {
    if (argv.list) {
      for (const id of listRecordedSessions()) {
        const loaded = loadSessionEvents(id);
        if (!loaded) continue;
        const span = formatDuration(loaded.endTime - loaded.startTime);
        console.log(
          `${id}  ${new Date(loaded.startTime).toISOString()}  ${loaded.events.length} events  ${span}`,
        );
      }
      return;
    }

    const sessionId = argv.sessionId ?? latestSessionId();
    if (!sessionId) {
      console.error("No recorded sessions found under ~/.freecode/rollout.");
      process.exitCode = 1;
      return;
    }

    if (argv.otlp !== undefined) {
      const target =
        argv.otlp.length > 0 ? { endpoint: argv.otlp } : otlpTargetFromEnv();
      if (!target) {
        console.error(
          "No OTLP endpoint. Pass --otlp <url> or set OTEL_EXPORTER_OTLP_ENDPOINT.",
        );
        process.exitCode = 1;
        return;
      }
      const loaded = loadSessionEvents(sessionId);
      if (!loaded) {
        console.error(`No recorded events for session ${sessionId}`);
        process.exitCode = 1;
        return;
      }
      await exportTrace(buildTrace(sessionId, loaded.events), target);
      console.log(`Exported ${sessionId} to ${target.endpoint}`);
      return;
    }

    if (!argv.follow) {
      console.log(render(sessionId, argv));
      return;
    }

    // Poll rather than tail: a trace is a fold over the whole log, so there is
    // no partial state to maintain and a redraw is cheap next to the seconds
    // of provider latency it exists to display.
    const draw = () => {
      process.stdout.write("\x1b[2J\x1b[H");
      console.log(render(sessionId, argv, Date.now()));
      console.log(`\n\x1b[2mwatching ${sessionId} — ctrl-c to stop\x1b[0m`);
    };
    draw();
    const timer = setInterval(draw, 1000);
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        clearInterval(timer);
        resolve();
      });
    });
  },
};
