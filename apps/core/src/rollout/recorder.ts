// =============================================================================
// Rollout Recorder - Append-only JSONL event writer
// PRIMARY: Write audit events to ~/.freecode/rollout/sessions/{sessionId}/events.jsonl
// EVENTS: TurnStarted, FunctionCall, FunctionOutput, etc.
// PURPOSE: Append-only log for debugging, replay, and analytics
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type {
  BaseEvent,
  DenySource,
  ModelErrorEvent,
  ModelRequestEvent,
  ModelResponseEvent,
  RedirectTriggeredEvent,
  RolloutEvent,
} from "./types.js";

// ============================================================================
// ULID Generator (Timestamp + Random)
// ============================================================================

function generateULID(): string {
  // ULID format: 48 bits timestamp + 80 bits random
  const timestamp = Date.now();
  const randomPart = Buffer.alloc(10);
  for (let i = 0; i < 10; i++) {
    randomPart[i] = Math.floor(Math.random() * 256);
  }
  // Crockford's Base32 encoding
  const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let result = "";
  // timestamp part (10 chars)
  let t = timestamp;
  for (let i = 9; i >= 0; i--) {
    result = ENCODING[t % 32] + result;
    t = Math.floor(t / 32);
  }
  // random part (10 chars)
  for (let i = 0; i < 10; i++) {
    result += ENCODING[randomPart[i] % 32];
  }
  return result;
}

// ============================================================================
// RolloutRecorder
// ============================================================================

export interface RecorderConfig {
  rolloutDir?: string;
  enabled?: boolean;
}

export interface RecordOptions {
  aggregateID: string;
  turnId?: string;
  tool?: string;
  args?: Record<string, unknown>;
  output?: string;
  duration_ms?: number;
  beforeTokens?: number;
  afterTokens?: number;
  subagentId?: string;
  task?: string;
  result?: string;
  skillName?: string;
  implicit?: boolean;
  hookName?: string;
  hookEvent?: string;
  blocked?: boolean;
  reason?: string;
  parser?: string;
  error?: string;
  seq?: number;
  /**
   * Escape hatch for event payloads with their own field sets, spread verbatim
   * onto the event. Model events carry a dozen fields that mean nothing to any
   * other event type; threading each one through the whitelist above would
   * double its length to describe a shape only one caller uses.
   */
  fields?: Record<string, unknown>;
}

export class RolloutRecorder {
  private sessionId: string;
  private eventsFilePath: string;
  private seq: number = 0;
  private enabled: boolean;

  constructor(sessionId: string, config?: RecorderConfig) {
    this.sessionId = sessionId;
    this.enabled = config?.enabled ?? true;

    const rolloutDir =
      config?.rolloutDir ??
      path.join(os.homedir(), ".freecode", "rollout", "sessions", sessionId);
    this.eventsFilePath = path.join(rolloutDir, "events.jsonl");
    // Resume seq after the last recorded event so per-aggregate sequence
    // numbers stay unique across process restarts.
    // ponytail: line count as seq; parse the last line's seq if lines and
    // events ever stop being 1:1.
    this.seq = this.countExistingEvents();
  }

  private countExistingEvents(): number {
    try {
      const content = fs.readFileSync(this.eventsFilePath, "utf-8");
      return content.split("\n").filter((line) => line.trim()).length;
    } catch {
      return 0;
    }
  }

  // ===========================================================================
  // PRIVATE: ensureDir()
  // ===========================================================================
  private ensureDir(): void {
    const dir = path.dirname(this.eventsFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ===========================================================================
  // PRIVATE: write()
  // ===========================================================================
  private write(event: RolloutEvent): void {
    if (!this.enabled) return;

    this.ensureDir();
    const line = JSON.stringify(event) + "\n";
    fs.appendFileSync(this.eventsFilePath, line, "utf-8");
  }

  // ===========================================================================
  // PRIVATE: makeEvent()
  // ===========================================================================
  private makeEvent(
    type: RolloutEvent["type"],
    opts: RecordOptions,
  ): RolloutEvent {
    this.seq++;
    const base = {
      id: generateULID(),
      seq: this.seq,
      aggregateID: opts.aggregateID,
      timestamp: Date.now(),
    };
    const extra: Record<string, unknown> = {};
    // Copy relevant fields based on event type
    if (opts.turnId) extra.turnId = opts.turnId;
    if (opts.tool) extra.tool = opts.tool;
    if (opts.args) extra.args = opts.args;
    // !== undefined: 0 and "" are legitimate values for these fields
    if (opts.output !== undefined) extra.output = opts.output;
    if (opts.duration_ms !== undefined) extra.duration_ms = opts.duration_ms;
    if (opts.beforeTokens !== undefined) extra.beforeTokens = opts.beforeTokens;
    if (opts.afterTokens !== undefined) extra.afterTokens = opts.afterTokens;
    if (opts.subagentId) extra.subagentId = opts.subagentId;
    if (opts.task) extra.task = opts.task;
    if (opts.result) extra.result = opts.result;
    if (opts.skillName) extra.skillName = opts.skillName;
    if (opts.implicit !== undefined) extra.implicit = opts.implicit;
    if (opts.hookName) extra.hookName = opts.hookName;
    if (opts.hookEvent) extra.hookEvent = opts.hookEvent;
    if (opts.blocked !== undefined) extra.blocked = opts.blocked;
    if (opts.reason) extra.reason = opts.reason;
    if (opts.parser) extra.parser = opts.parser;
    if (opts.error) extra.error = opts.error;
    if (opts.seq !== undefined) extra.seq = opts.seq;

    return { type, ...base, ...extra, ...opts.fields } as RolloutEvent;
  }

  // ===========================================================================
  // PUBLIC: recordTurnStarted()
  // ===========================================================================
  recordTurnStarted(turnId: string): void {
    const event = this.makeEvent("turn.started", {
      aggregateID: this.sessionId,
      turnId,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordTurnAborted()
  // ===========================================================================
  recordTurnAborted(turnId: string, reason: string): void {
    const event = this.makeEvent("turn.aborted", {
      aggregateID: this.sessionId,
      turnId,
      reason,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordFunctionCall()
  // ===========================================================================
  recordFunctionCall(
    tool: string,
    args: Record<string, unknown>,
    turnId: string,
    callId?: string,
  ): void {
    const event = this.makeEvent("function.call", {
      aggregateID: this.sessionId,
      tool,
      args,
      turnId,
      ...(callId ? { fields: { callId } } : {}),
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordFunctionOutput()
  // ===========================================================================
  recordFunctionOutput(
    tool: string,
    output: string,
    duration_ms: number,
    turnId: string,
    failed?: boolean,
    callId?: string,
  ): void {
    const fields: Record<string, unknown> = {};
    if (failed !== undefined) fields.failed = failed;
    if (callId) fields.callId = callId;
    const event = this.makeEvent("function.output", {
      aggregateID: this.sessionId,
      tool,
      output,
      duration_ms,
      turnId,
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordFunctionDenied()
  // ===========================================================================
  /**
   * A tool call that was refused before it ran. Paired with nothing — there is
   * no output to wait for — so `buildTrace` folds it on its own.
   */
  recordFunctionDenied(
    tool: string,
    args: Record<string, unknown>,
    source: DenySource,
    reason: string,
    turnId: string,
  ): void {
    const event = this.makeEvent("function.denied", {
      aggregateID: this.sessionId,
      tool,
      args,
      reason,
      turnId,
      fields: { source },
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordCompactOccurred()
  // ===========================================================================
  recordCompactOccurred(beforeTokens: number, afterTokens: number): void {
    const event = this.makeEvent("compact.occurred", {
      aggregateID: this.sessionId,
      beforeTokens,
      afterTokens,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordSubagentStart()
  // ===========================================================================
  recordSubagentStart(subagentId: string, task: string): void {
    const event = this.makeEvent("subagent.start", {
      aggregateID: this.sessionId,
      subagentId,
      task,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordSubagentStop()
  // ===========================================================================
  recordSubagentStop(subagentId: string, result: string): void {
    const event = this.makeEvent("subagent.stop", {
      aggregateID: this.sessionId,
      subagentId,
      result,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordSkillInvoked()
  // ===========================================================================
  recordSkillInvoked(skillName: string, implicit: boolean): void {
    const event = this.makeEvent("skill.invoked", {
      aggregateID: this.sessionId,
      skillName,
      implicit,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordHookTriggered()
  // ===========================================================================
  recordHookTriggered(
    hookName: string,
    hookEvent: string,
    blocked: boolean,
  ): void {
    const event = this.makeEvent("hook.triggered", {
      aggregateID: this.sessionId,
      hookName,
      hookEvent,
      blocked,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordHookBlocked()
  // ===========================================================================
  recordHookBlocked(hookName: string, reason: string): void {
    const event = this.makeEvent("hook.blocked", {
      aggregateID: this.sessionId,
      hookName,
      reason,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordContextOverflow()
  // ===========================================================================
  recordContextOverflow(beforeTokens: number): void {
    const event = this.makeEvent("context.overflow", {
      aggregateID: this.sessionId,
      beforeTokens,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: recordParseError()
  // ===========================================================================
  recordParseError(turnId: string, parser: string, error: string): void {
    const event = this.makeEvent("parse.error", {
      aggregateID: this.sessionId,
      turnId,
      parser,
      error,
    });
    this.write(event);
  }

  // ===========================================================================
  // PUBLIC: model call events
  //
  // Written around the provider round trip. recordModelRequest() fires BEFORE
  // the call so that a hang leaves a request with no terminator — the absence
  // is the diagnosis.
  // ===========================================================================
  recordModelRequest(
    turnId: string,
    fields: Omit<ModelRequestEvent, keyof BaseEvent | "type" | "turnId">,
  ): void {
    this.write(
      this.makeEvent("model.request", {
        aggregateID: this.sessionId,
        turnId,
        fields,
      }),
    );
  }

  recordModelFirstToken(turnId: string, ttft_ms: number): void {
    this.write(
      this.makeEvent("model.first_token", {
        aggregateID: this.sessionId,
        turnId,
        fields: { ttft_ms },
      }),
    );
  }

  recordModelResponse(
    turnId: string,
    fields: Omit<ModelResponseEvent, keyof BaseEvent | "type" | "turnId">,
  ): void {
    this.write(
      this.makeEvent("model.response", {
        aggregateID: this.sessionId,
        turnId,
        fields,
      }),
    );
  }

  recordModelError(
    turnId: string,
    fields: Omit<ModelErrorEvent, keyof BaseEvent | "type" | "turnId">,
  ): void {
    this.write(
      this.makeEvent("model.error", {
        aggregateID: this.sessionId,
        turnId,
        fields,
      }),
    );
  }

  // ===========================================================================
  // PUBLIC: trajectory redirection events
  // The advice text itself is never written here — see the note in types.ts.
  // ===========================================================================
  recordRedirectTriggered(
    turnId: string,
    fields: Omit<RedirectTriggeredEvent, keyof BaseEvent | "type" | "turnId">,
  ): void {
    this.write(
      this.makeEvent("redirect.triggered", {
        aggregateID: this.sessionId,
        turnId,
        fields,
      }),
    );
  }

  /**
   * Read back what this recorder has written.
   *
   * The redirect evidence fold reads through the recorder rather than through
   * `history.loadSessionEvents()`, which resolves the default rollout path: an
   * injected recorder (tests, an alternate `rolloutDir`) must stay
   * authoritative, or the loop would form evidence from a different session's
   * log than the one it is writing. Returns [] when recording is disabled or
   * the file does not exist yet.
   */
  readEvents(): RolloutEvent[] {
    if (!this.enabled) return [];
    try {
      return fs
        .readFileSync(this.eventsFilePath, "utf-8")
        .split("\n")
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as RolloutEvent];
          } catch {
            // A truncated final line must not cost the whole log.
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  recordRedirectSkipped(turnId: string, reason: string): void {
    this.write(
      this.makeEvent("redirect.skipped", {
        aggregateID: this.sessionId,
        turnId,
        reason,
      }),
    );
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createRecorder(
  sessionId: string,
  config?: RecorderConfig,
): RolloutRecorder {
  return new RolloutRecorder(sessionId, config);
}
