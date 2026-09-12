#!/usr/bin/env tsx
// =============================================================================
// Scan every recorded session's rollout log and publish the signals report.
//
//   pnpm bench:signals                 # ~/.freecode/rollout/sessions → apps/web/app/data/harness/signals.json
//   pnpm bench:signals --since 30      # only sessions that started in the last 30 days
//   pnpm bench:signals --rollout-dir D # another log root (an eval sandbox, a bench HOME)
//   pnpm bench:signals --json          # print instead of writing
//
// Free: no model, no network. Numbers only reach the file — no item text, no
// session ids, no prompts (fold.ts). Run it after any batch of sessions worth
// counting; the page reads the committed file at build time.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { aggregate, foldSession, type RawEvent, type SessionSignals } from "./fold.js";

const ROOT = path.join(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "apps", "web", "app", "data", "harness", "signals.json");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const rolloutDir =
  arg("rollout-dir") ?? path.join(os.homedir(), ".freecode", "rollout", "sessions");
const sinceDays = arg("since") ? Number(arg("since")) : undefined;
const cutoff = sinceDays ? Date.now() - sinceDays * 86_400_000 : 0;

export function readEvents(file: string): RawEvent[] {
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as RawEvent];
      } catch {
        return [];
      }
    });
}

function main() {
  if (!fs.existsSync(rolloutDir)) {
    console.error(`no rollout dir at ${rolloutDir}`);
    process.exit(1);
  }
  const sessions: SessionSignals[] = [];
  let scanned = 0;
  for (const id of fs.readdirSync(rolloutDir)) {
    const file = path.join(rolloutDir, id, "events.jsonl");
    if (!fs.existsSync(file)) continue;
    const events = readEvents(file);
    if (events.length === 0) continue;
    if (cutoff && (events[0]!.timestamp ?? 0) < cutoff) continue;
    scanned++;
    const folded = foldSession(events);
    if (folded) sessions.push(folded);
  }
  const report = aggregate(sessions, scanned);
  const text = JSON.stringify(report, null, 2) + "\n";
  if (process.argv.includes("--json")) {
    process.stdout.write(text);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log(
    `${path.relative(process.cwd(), OUT)}: ${scanned} sessions scanned, ${report.sessionsWithTodos} with todos, ` +
      `${report.confidence.n} confidence trajectories, ${report.hillClimb.n} hill-climb ratings, ` +
      `${report.autoPoke.pokes} pokes, ended-open ${report.autoPoke.sessionsEndedOpen}/${report.autoPoke.sessionsWithTodos}`,
  );
}

main();
