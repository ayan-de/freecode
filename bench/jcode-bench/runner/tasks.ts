// =============================================================================
// Upstream tasks — the public 1jehuang/jcode-bench repo, cloned once, staged
// fresh per trial.
//
// The tasks are not copied into this repo on purpose: the spec, the given
// implementation and the grader are the benchmark, and a fork that drifts
// from upstream stops being comparable with jcode's published numbers. The
// commit is recorded on every trial.
// =============================================================================

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export const UPSTREAM = "https://github.com/1jehuang/jcode-bench.git";
const ROOT = path.join(import.meta.dirname, "..");
const CACHE = path.join(ROOT, ".cache", "upstream");

function sh(cmd: string, args: string[], cwd?: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

/**
 * Resolve the task repo: `JCODE_BENCH_DIR` if set (a local checkout, for
 * offline runs or a pinned commit), else the cached clone, cloned on first use.
 */
export function ensureUpstream(): { dir: string; commit: string } {
  const dir = process.env.JCODE_BENCH_DIR ?? CACHE;
  if (!fs.existsSync(path.join(dir, "harness", "grade.py"))) {
    if (process.env.JCODE_BENCH_DIR) {
      throw new Error(`JCODE_BENCH_DIR=${dir} has no harness/grade.py`);
    }
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    console.log(`cloning ${UPSTREAM} → ${path.relative(process.cwd(), dir)}`);
    sh("git", ["clone", "--depth", "1", UPSTREAM, dir]);
  }
  const commit = sh("git", ["rev-parse", "--short", "HEAD"], dir);
  return { dir, commit };
}

export function listTasks(upstream: string): string[] {
  const tasksDir = path.join(upstream, "tasks");
  return fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(tasksDir, d.name, "grade")))
    .map((d) => d.name)
    .sort();
}

/** The spec's first paragraph after the title — the page's one-liner. */
export function taskOneLiner(upstream: string, task: string): string {
  const spec = path.join(upstream, "tasks", task, "spec.md");
  if (!fs.existsSync(spec)) return "";
  const body = fs.readFileSync(spec, "utf-8").split("\n");
  const start = body.findIndex((l, i) => i > 0 && l.trim() && !l.startsWith("#"));
  if (start < 0) return "";
  const para: string[] = [];
  for (let i = start; i < body.length && body[i]!.trim(); i++) para.push(body[i]!.trim());
  return para.join(" ");
}

/** Everything the grader needs, nothing a previous run left behind. */
const SKIP = new Set([".build", "scores.jsonl", "__pycache__"]);

function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/**
 * Stage one task into `wsDir` so `./grade` works there. The upstream `grade`
 * wrapper imports `../../harness/grade.py`, so the workspace mirrors the
 * repo's shape: `<ws>/harness/` + `<ws>/tasks/<task>/`. Returns the task dir,
 * which is the agent's cwd.
 */
export function stageTask(upstream: string, task: string, wsDir: string): string {
  const src = path.join(upstream, "tasks", task);
  if (!fs.existsSync(path.join(src, "grade"))) throw new Error(`no such task: ${task}`);
  copyTree(path.join(upstream, "harness"), path.join(wsDir, "harness"));
  const taskDir = path.join(wsDir, "tasks", task);
  copyTree(src, taskDir);
  // The grader's fresh-corpus + given-cost cache is per workspace: nothing
  // from another trial can leak in, and the given binary is rebuilt here.
  fs.chmodSync(path.join(taskDir, "grade"), 0o755);
  return taskDir;
}

/** The diff of submission/ against the given — the artifact that IS the result. */
export function submissionDiff(upstream: string, task: string, taskDir: string): string {
  const r = spawnSync(
    "diff",
    ["-ruN", path.join(upstream, "tasks", task, "submission"), path.join(taskDir, "submission")],
    { encoding: "utf-8" },
  );
  return r.stdout;
}
