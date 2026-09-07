// =============================================================================
// ShellRegistry - per-session registry of background shells.
//
// `bash(run_in_background: true)` starts a process here and returns an id
// immediately, so a dev server or a long build stops holding the turn. The
// model drains new output with `bashoutput` and stops the process with
// `killbash`; the TUI's shells panel reads the same registry over IPC.
//
// Output is held in a character-capped ring buffer, not on disk: a dev server
// left running for an hour must not grow without bound. When the cap is hit the
// OLDEST output is dropped and `droppedChars` reports it — a reader is told what
// it missed rather than silently handed a gap.
// =============================================================================

import type { ShellReadResult, ShellStatus, ShellSummary } from "./types.js";
import { spawnShell } from "./spawn.js";

/** Per-shell ring-buffer cap. A dev server can log for hours; keep the tail. */
export const SHELL_BUFFER_CHARS = 256_000;
/** Trim in blocks so a chatty process doesn't re-slice the buffer per chunk. */
const TRIM_BLOCK = SHELL_BUFFER_CHARS >> 2;
/** Ceiling on concurrent shells per session — a runaway loop can't fork-bomb. */
export const MAX_SHELLS_PER_SESSION = 16;

export interface ShellStartOptions {
  command: string;
  cwd: string;
  /** Notified on every chunk so the loop can relay it to the TUI live. */
  onData?: (id: string, chunk: string) => void;
  /** Notified once the process settles, for the same reason. */
  onExit?: (id: string, status: ShellStatus, exitCode: number | null) => void;
}

interface Shell {
  id: string;
  command: string;
  cwd: string;
  status: ShellStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt?: number;
  buf: string;
  /** Characters dropped off the front of `buf`; also the buffer's base offset. */
  droppedChars: number;
  /** Absolute offset the model's `bashoutput` has consumed up to. */
  modelCursor: number;
  kill: (signal: NodeJS.Signals) => void;
  /** Kept on the record so kill() can fire it too, not just the exit handler. */
  notifyExit?: (id: string, status: ShellStatus, code: number | null) => void;
}

export class ShellRegistry {
  private shells = new Map<string, Shell>();
  private seq = 0;

  /**
   * Spawn a background shell. Throws only when the session is already at
   * MAX_SHELLS_PER_SESSION — a spawn failure surfaces as a `failed` shell so
   * the model reads the error out of `bashoutput` like any other output.
   */
  start(options: ShellStartOptions): ShellSummary {
    if (this.runningCount() >= MAX_SHELLS_PER_SESSION) {
      throw new Error(
        `Too many background shells (${MAX_SHELLS_PER_SESSION}). Kill one with killbash before starting another.`,
      );
    }

    const id = `bash_${++this.seq}`;
    const { child, killTree } = spawnShell(options.command, options.cwd);

    const shell: Shell = {
      id,
      command: options.command,
      cwd: options.cwd,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      buf: "",
      droppedChars: 0,
      modelCursor: 0,
      kill: killTree,
      notifyExit: options.onExit,
    };
    this.shells.set(id, shell);

    const append = (chunk: string): void => {
      shell.buf += chunk;
      if (shell.buf.length > SHELL_BUFFER_CHARS) {
        const drop = shell.buf.length - SHELL_BUFFER_CHARS + TRIM_BLOCK;
        shell.buf = shell.buf.slice(drop);
        shell.droppedChars += drop;
      }
      options.onData?.(id, chunk);
    };

    child.stdout?.on("data", (d: Buffer) => append(d.toString()));
    child.stderr?.on("data", (d: Buffer) => append(d.toString()));

    const settle = (status: ShellStatus, code: number | null): void => {
      if (shell.status !== "running") return;
      shell.status = status;
      shell.exitCode = code;
      shell.endedAt = Date.now();
      options.onExit?.(id, status, code);
    };

    child.on("error", (err) => {
      append(`\n<shell_error>\n${err.message}\n</shell_error>\n`);
      settle("failed", null);
    });
    // `close` can never fire while a grandchild holds the pipe open, so settle
    // on `exit` — the same race the foreground path guards against.
    child.on("exit", (code, signal) => {
      if (signal) settle("killed", code);
      else settle(code === 0 ? "completed" : "failed", code);
    });

    return this.summarize(shell);
  }

  /**
   * Drain everything the model has not seen yet and advance its cursor. This is
   * the `bashoutput` contract: each call returns only new output.
   */
  readForModel(id: string): ShellReadResult {
    const shell = this.shells.get(id);
    if (!shell) return missing();
    const result = this.readFrom(id, shell.modelCursor);
    shell.modelCursor = result.nextCursor;
    return result;
  }

  /**
   * Positional read that leaves the model's cursor alone — the TUI panel polls
   * through this so opening the panel never eats output the model still owes.
   */
  readFrom(id: string, cursor: number): ShellReadResult {
    const shell = this.shells.get(id);
    if (!shell) return missing();
    const end = shell.droppedChars + shell.buf.length;
    const from = Math.max(cursor, shell.droppedChars);
    return {
      found: true,
      text: shell.buf.slice(from - shell.droppedChars),
      status: shell.status,
      exitCode: shell.exitCode,
      droppedChars: Math.max(0, shell.droppedChars - cursor),
      nextCursor: end,
    };
  }

  list(): ShellSummary[] {
    return [...this.shells.values()].map((s) => this.summarize(s));
  }

  get(id: string): ShellSummary | undefined {
    const shell = this.shells.get(id);
    return shell ? this.summarize(shell) : undefined;
  }

  /**
   * Forget a settled shell, discarding its buffered output.
   *
   * Refuses while the process is still running: dropping the record would
   * leak the process — nothing else holds a handle to kill it. Kill first,
   * then remove. Returns false for an unknown id or a running one.
   */
  remove(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell || shell.status === "running") return false;
    this.shells.delete(id);
    return true;
  }

  /**
   * SIGTERM the process group. Returns false for an unknown id or one that has
   * already settled, so the caller can say which happened.
   */
  kill(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell || shell.status !== "running") return false;
    shell.kill("SIGTERM");
    // Settle here rather than waiting for the `exit` handler, so a second kill
    // is a no-op and the UI flips immediately instead of after the signal
    // lands. That short-circuits the exit handler's own settle(), so the exit
    // notification has to be fired here or a model-initiated killbash would
    // never reach the frontend and its shell counter would stay stale.
    shell.status = "killed";
    shell.endedAt = Date.now();
    shell.notifyExit?.(id, "killed", null);
    return true;
  }

  /** Session teardown: nothing may outlive the session that started it. */
  killAll(): void {
    for (const shell of this.shells.values()) {
      if (shell.status === "running") {
        shell.kill("SIGKILL");
        shell.status = "killed";
        shell.endedAt = Date.now();
        shell.notifyExit?.(shell.id, "killed", null);
      }
    }
    this.shells.clear();
  }

  private runningCount(): number {
    let n = 0;
    for (const s of this.shells.values()) if (s.status === "running") n++;
    return n;
  }

  private summarize(shell: Shell): ShellSummary {
    return {
      id: shell.id,
      command: shell.command,
      cwd: shell.cwd,
      status: shell.status,
      exitCode: shell.exitCode,
      startedAt: shell.startedAt,
      endedAt: shell.endedAt,
      bufferedChars: shell.buf.length,
      truncated: shell.droppedChars > 0,
    };
  }
}

function missing(): ShellReadResult {
  return {
    found: false,
    text: "",
    status: "failed",
    exitCode: null,
    droppedChars: 0,
    nextCursor: 0,
  };
}
