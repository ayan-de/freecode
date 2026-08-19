// =============================================================================
// Browser Chat — provider
//
// Implements AIProvider by driving a chat website. The tool-call emulation is
// entirely inside this module: it renders ToolDef[] into the bootstrap text and
// parses replies back into toolCalls[]. The agent loop must not learn that a
// browser exists.
//
// This module is imported lazily by index.ts, never at startup — it is where
// the transport, and therefore Playwright, gets pulled in.
// =============================================================================

import type {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
  ProviderInfo,
} from "../providers/types.js";
import type { Message } from "../agent/types.js";
import { readBrowserChatConfig } from "./config.js";
import { getSiteAdapter } from "./sites/index.js";
import { CdpTransport } from "./transport/cdp.js";
import { ExtensionTransport } from "./transport/extension.js";
import type { BrowserTransport } from "./transport/types.js";
import type { ThreadHandle } from "./transport/types.js";
import { buildBootstrap, renderOutgoing } from "./protocol/encode.js";
import { parseReply, type ParsedReply } from "./protocol/parse.js";
import { buildRepairMessage } from "./protocol/repair.js";
import { createStreamFilter } from "./protocol/stream-filter.js";
import { SentLog } from "./thread.js";
import { ThreadMeter } from "./limits/meter.js";
import { classifyLimit } from "./limits/detect.js";
import { ThreadFullError } from "./limits/errors.js";
import { SentLedger } from "./cache/ledger.js";
import {
  diffProjectContext,
  extractProjectContext,
} from "./protocol/context-delta.js";
import type { SiteId } from "./types.js";

interface ThreadState {
  handle: ThreadHandle;
  sentLog: SentLog;
  meter: ThreadMeter;
  ledger: SentLedger;
  /** Last project context this thread saw, for delta computation. */
  lastContext: string | null;
}

function flattenSystem(system: ExecuteOptions["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((block) => block.text).join("\n\n");
}

/** Char-based, and honestly labelled: we cannot see the site's tokenizer. */
function estimateUsage(
  sent: string,
  received: string,
): NonNullable<ExecuteResult["usage"]> {
  return {
    inputTokens: Math.ceil(sent.length / 4),
    outputTokens: Math.ceil(received.length / 4),
  };
}

export function createBrowserChatProvider(
  site: SiteId,
  info: ProviderInfo,
): AIProvider {
  const threads = new Map<string, ThreadState>();
  let transport: BrowserTransport | null = null;

  async function ensureTransport(): Promise<BrowserTransport> {
    if (transport?.isConnected()) return transport;
    const config = readBrowserChatConfig();

    if (config.transport === "extension") {
      const extension = new ExtensionTransport(config.bridgePort);
      await extension.connect();
      if (!(await extension.waitForBrowser(60_000))) {
        throw new Error(
          "browser-chat: no browser tab checked in. Load apps/extension, open " +
            "the chat site, and reload the tab.",
        );
      }
      transport = extension;
      return transport;
    }

    transport = new CdpTransport(config.cdpUrl, {
      autoLaunch: config.autoLaunch,
      profileDir: config.profileDir,
      binary: config.binary,
      headless: config.headless,
    });
    await transport.connect();
    return transport;
  }

  /** Sends one message and returns the model's full reply text. */
  async function* roundTrip(
    handle: ThreadHandle,
    text: string,
    emit: (delta: string) => ProviderChunk,
  ): AsyncGenerator<ProviderChunk, string> {
    const active = await ensureTransport();
    await active.send(handle, text);

    const filter = createStreamFilter();
    for await (const chunk of active.receive(handle)) {
      if (chunk.type === "delta") {
        const visible = filter.push(chunk.text);
        if (visible) yield emit(visible);
      } else if (chunk.type === "limit") {
        // Typed so the caller can tell "roll to a new chat" (recoverable)
        // apart from "you are out of messages" (not).
        throw classifyLimit(chunk).error;
      } else if (chunk.type === "error") {
        throw new Error(`browser-chat: ${chunk.message}`);
      }
    }
    const tail = filter.flush();
    if (tail) yield emit(tail);

    if (!active.sawCompletionRequest(handle)) {
      throw new Error(
        "browser-chat: no completion request was observed — the site adapter " +
          "is likely stale. Run `freecode browser doctor --raw`.",
      );
    }
    return filter.full();
  }

  async function* stream(
    opts: ExecuteOptions,
  ): AsyncGenerator<ProviderChunk> {
    const config = readBrowserChatConfig();
    const messages = opts.messages ?? [];
    const key = opts.sessionId ?? "default";
    const active = await ensureTransport();

    // Opens a brand-new chat and returns the bootstrap text. Shared by three
    // callers: first turn, contradiction, and rollover — all of which mean
    // "this thread cannot carry the conversation any further".
    const bootstrapThread = async (): Promise<{
      state: ThreadState;
      outgoing: string;
    }> => {
      const previous = threads.get(key);
      if (previous) await active.closeThread(previous.handle).catch(() => {});
      // newChat matters for the extension transport: a bootstrap must land in
      // a fresh conversation, not on top of whatever the user had open.
      const handle = await active.openThread(getSiteAdapter(site), {
        newChat: true,
      });
      const fresh: ThreadState = {
        handle,
        sentLog: new SentLog(),
        meter: new ThreadMeter(),
        // A new thread holds none of the previous thread's results, so the
        // ledger starts empty. Carrying it over would be wrong 100% of the
        // time, not probabilistically (spec, ledger safety rules).
        ledger: new SentLedger(config.ledgerMaxAgeChars),
        lastContext: extractProjectContext(messages),
      };
      threads.set(key, fresh);
      return {
        state: fresh,
        outgoing: buildBootstrap({
          system: flattenSystem(opts.system),
          tools: opts.tools ?? [],
          messages,
          maxToolResultChars: config.maxToolResultChars,
        }),
      };
    };

    const existing = threads.get(key);
    const divergence = existing?.sentLog.classify(messages) ?? {
      kind: "fresh" as const,
    };
    // Proactive rollover: predicting a little early costs one bootstrap;
    // predicting late costs a wasted round trip AND a bootstrap.
    const overBudget =
      existing?.meter.shouldRollover(config.threadBudgetChars) ?? false;

    let state: ThreadState;
    let outgoing: string;
    if (divergence.kind === "append" && existing && !overBudget) {
      state = existing;
      outgoing = renderOutgoing(
        divergence.newMessages,
        config.maxToolResultChars,
        {
          ledger: existing.ledger,
          charsNow: existing.meter.totalChars,
          turn: existing.meter.turnCount,
        },
      );
      // The tree shipped in the bootstrap; send only what moved since.
      const context = extractProjectContext(messages);
      if (context && existing.lastContext) {
        const delta = diffProjectContext(existing.lastContext, context);
        if (delta) outgoing = `${delta}\n\n${outgoing}`;
      }
      if (context) existing.lastContext = context;
    } else {
      ({ state, outgoing } = await bootstrapThread());
    }

    if (outgoing.trim().length === 0) {
      yield { type: "done", stopReason: "stop" };
      return;
    }

    const emit = (delta: string): ProviderChunk => ({
      type: "text_delta",
      delta,
    });

    let reply: string;
    try {
      reply = yield* roundTrip(state.handle, outgoing, emit);
    } catch (error) {
      // The site hit the wall before our char-based meter did. That is an
      // expected miss, not a failure: roll to a new chat and replay the turn.
      // A usage limit is NOT caught here — a new chat draws on the same quota.
      if (!(error instanceof ThreadFullError)) throw error;
      ({ state, outgoing } = await bootstrapThread());
      reply = yield* roundTrip(state.handle, outgoing, emit);
    }
    state.meter.noteSent(outgoing);
    state.meter.noteReceived(reply);

    let parsed: ParsedReply = parseReply(reply);

    // Repair fires only when nothing parseable was found — a correct block in
    // the wrong fence already succeeded in parseReply at zero cost.
    for (
      let attempt = 1;
      parsed.violation && attempt <= config.maxRepairAttempts;
      attempt++
    ) {
      const repair = buildRepairMessage(
        attempt,
        parsed.violation,
        config.maxRepairAttempts,
      );
      if (!repair) break;
      reply = yield* roundTrip(state.handle, repair, emit);
      // Repair traffic counts against the thread like anything else.
      state.meter.noteSent(repair);
      state.meter.noteReceived(reply);
      parsed = parseReply(reply);
    }

    if (parsed.violation) {
      throw new Error(
        `browser-chat: the model would not follow the tool protocol after ` +
          `${config.maxRepairAttempts} attempts (${parsed.violation}).`,
      );
    }

    state.sentLog.commit(messages);
    for (const call of parsed.toolCalls) {
      yield { type: "tool_call", id: call.id, name: call.name, args: call.args };
    }
    yield { type: "usage", usage: estimateUsage(outgoing, reply) };
    yield {
      type: "done",
      stopReason: parsed.toolCalls.length > 0 ? "tool_use" : "stop",
    };
  }

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    let content = "";
    const toolCalls: NonNullable<ExecuteResult["toolCalls"]> = [];
    let usage: ExecuteResult["usage"];
    let stopReason: ExecuteResult["stopReason"] = "unknown";

    for await (const chunk of stream(opts)) {
      if (chunk.type === "text_delta") content += chunk.delta;
      else if (chunk.type === "tool_call")
        toolCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
      else if (chunk.type === "usage") usage = chunk.usage;
      else if (chunk.type === "done") stopReason = chunk.stopReason;
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      stopReason,
      provider: info.id,
      model: info.defaultModel,
    };
  }

  return { info, execute, stream };
}
