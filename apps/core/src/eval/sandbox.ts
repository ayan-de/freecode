// =============================================================================
// Tier 1 sandbox — a tmpdir seeded from `files`, and nothing else (spec §6.1).
//
// No `node_modules`, no install step, no network. That is why §4 mandates
// dependency-free fixtures: the moment a `verify` needs `npx tsx`, the harness
// needs a package install per case, and an eval suite whose setup can fail for
// network reasons is one that gets disabled.
//
// What this buys, stated honestly (spec §6.3): it is WORKING-TREE isolation,
// not agent isolation. An agent holding `bash` can `cd` anywhere on the
// filesystem regardless of where its project root points. This protects the
// files you were editing when you launched the suite. Real isolation is a
// container, and that is a §13 item, not this one.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export class SandboxError extends Error {}

export interface Sandbox {
  /** Absolute path to the seeded directory. Becomes the case's project root. */
  dir: string;
  cleanup(): void;
}

/**
 * Keep the tmpdir after the trial so a red case can be inspected. Off by
 * default: twenty cases times three trials is sixty directories, and a harness
 * that silently fills /tmp is one people stop running.
 */
const KEEP = process.env.FREECODE_EVAL_KEEP_SANDBOX === "1";

/**
 * A fixture path must stay inside the sandbox. Checked at DATASET LOAD time as
 * well as here, so a case that would escape is rejected before a token is
 * spent rather than at seeding time, when it reads as a harness crash.
 */
export function assertSafeRelativePath(rel: string, where: string): void {
  if (!rel.trim()) throw new SandboxError(`${where}: empty file path`);
  if (path.isAbsolute(rel)) {
    throw new SandboxError(`${where}: '${rel}' must be relative`);
  }
  const normalised = path.normalize(rel);
  if (normalised === ".." || normalised.startsWith(`..${path.sep}`)) {
    throw new SandboxError(`${where}: '${rel}' escapes the sandbox`);
  }
}

export function createSandbox(files: Record<string, string>): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-eval-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      assertSafeRelativePath(rel, "sandbox");
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf-8");
    }
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  return {
    dir,
    cleanup() {
      if (KEEP) {
        console.error(`  kept sandbox ${dir}`);
        return;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Whether a tool's path argument resolves inside the sandbox. */
export function insideSandbox(dir: string, target: string): boolean {
  const rel = path.relative(dir, path.resolve(dir, target));
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
