// =============================================================================
// The official final grade — the upstream `./grade`, run by the harness after
// the agent exits, on the submission exactly as it was left.
//
// This is separate from the agent's own grades on purpose: `best` on the page
// is the highest sample the AGENT saw, and jcode's page notes it can sit above
// the official final because not every sample runs the full gate. `final` is
// the number that counts; a failed verify makes it null.
// =============================================================================

import { spawnSync } from "child_process";
import { parseFinalScore } from "./curve.js";

export interface FinalGrade {
  score: number | null;
  fullGate: boolean;
  verified: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function finalGrade(
  taskDir: string,
  opts: { full: boolean; timeoutMs: number },
): FinalGrade {
  const started = Date.now();
  const r = spawnSync("python3", ["grade", ...(opts.full ? ["--full"] : []), "--quiet"], {
    cwd: taskDir,
    encoding: "utf-8",
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = r.stdout ?? "";
  const score = r.status === 0 ? parseFinalScore(stdout) : null;
  return {
    score,
    fullGate: opts.full,
    verified: r.status === 0 && score !== null,
    stdout,
    stderr: r.stderr ?? "",
    durationMs: Date.now() - started,
  };
}

/** The grader needs cc, python3 and valgrind. Say which is missing before spending. */
export function checkToolchain(): void {
  const missing = ["cc", "python3", "valgrind"].filter(
    (bin) => spawnSync(bin, ["--version"], { encoding: "utf-8" }).status !== 0,
  );
  if (missing.length) {
    throw new Error(
      `jcode-bench needs ${missing.join(", ")} on PATH (callgrind is the cost model). ` +
        `Arch: sudo pacman -S valgrind gcc python; Debian: sudo apt install valgrind build-essential python3`,
    );
  }
}
