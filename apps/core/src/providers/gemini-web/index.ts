// =============================================================================
// Gemini via a logged-in web session — ask/review mode.
//
// Drives a signed-in (or anonymous) gemini.google.com session as a provider,
// so a session can run on a free web account instead of a metered API key.
// Speaks Gemini's internal batchexecute RPC directly — see protocol.ts and
// client.ts. No sidecar, no SDK, no extra dependency: fetch and a sha1.
//
// Sending the loop's tools RAW to this endpoint does not work, and knowing
// why is what shaped everything here. Measured over 9 real turns of the agent
// loop, the session emitted a tool call ~56% of the time. The other 44% it
// answered from priors with total fluency — inventing file contents, and once
// replying to "what is the first line of TRACE.md" with US Census population
// statistics. A backend that silently fabricates on half its turns is worse
// than one that errors.
//
// Three arms were measured on one task ("quote the first line of TRACE.md"):
//
//   minimal system prompt + read tool    1.8 KB    5/9 called the tool
//   full freecode system prompt + 16 tools  100.7 KB  5/9 correct
//   no tools, file contents inlined      9.8 KB    4/4 correct, 0 empty
//
// Shrinking the prompt 55× and cutting 16 tools to 1 changed nothing. Removing
// the *need* for a tool call fixed it. Two answers came out of that: @mention
// inlining (the user names files, core reads them — inline.ts), and the tool
// bridge below, which restructures the channel so a skipped tool call is
// detectable instead of silent.
//
// THE TOOL BRIDGE — ON BY DEFAULT since 2026-09-05 (spec §10.4), opt out with
// `web["gemini-web"].experimentalTools: false` or FREECODE_GEMINI_WEB_TOOLS=0:
// tool-bridge.ts speaks a tool-call protocol in plain text — the reply must
// be either a [TOOL_CALLS] block or begin with FINAL:, anything else is a
// detectable violation that gets one corrective re-prompt, and streaming is
// withheld until the reply classifies so a violation can be retried before
// anything reached the screen. That structure is what the measurements above
// lacked, and evals/gemini-web-tools.jsonl is the watchdog (16/16 trials at
// the flip). With tools on the wire, the loop's permission modes gate them
// exactly as for any other provider — D1's "no mode gating needed" corollary
// applies only to the opted-out path. @mention inlining stays active either
// way.
// =============================================================================

import type { Message, MessagePart } from "../../agent/types.js";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
  ToolDef,
} from "../types.js";
import { registerProvider } from "../registry.js";
import { findMentions, inlineFiles } from "./inline.js";
import { generate, generateStream } from "./client.js";
import { DEFAULT_MODEL, resolveGeminiWebModel } from "./models.js";
import { loadGeminiWebSettings } from "./settings.js";
import {
  buildToolProtocol,
  correctionPrompt,
  parseReply,
  StreamGate,
} from "./tool-bridge.js";
import { logger } from "../../utils/logger.js";

// Short on purpose. The 100 KB freecode preamble scored no better than 1.8 KB,
// and every byte here is re-sent on every turn against an opaque quota.
// The last sentence is the load-bearing one: without it the model reaches for
// tools it has not been given and narrates the call instead of answering.
const SYSTEM_PROMPT = [
  "You are a code reading assistant. The user works in a software project and",
  "will reference files with @mentions; the full contents of those files are",
  "included in the message.",
  "",
  "Answer the question directly and concisely. Quote exactly — never invent",
  "code, filenames, line numbers or output that is not present in what you were",
  "given. You cannot open files, run commands, or edit anything.",
  "",
  // An earlier draft ended "say which one and stop", and it was obeyed too
  // well: one mistyped filename among several made the model refuse the whole
  // question instead of answering the parts it had the files for.
  "If a file you need was not included, name it and answer whatever the",
  "included files do cover — do not guess at the rest.",
].join("\n");

// Every tool round trip is another request against the throttle that E3
// measured at 3/5 empty back-to-back. This gap plus the client's empty-reply
// retry keeps a tool loop moving without burning the quota dry.
const TOOL_REQUEST_GAP_MS = 8_000;

// Tool results are re-sent every turn (no server-side thread), against the
// same ~60 KB payload ceiling the inline budget respects. Newest results keep
// their bytes; older ones collapse to a one-line marker — same philosophy as
// inline.ts: visible elision, never silent shortening.
const TOOL_RESULT_BUDGET_BYTES = 20_000;
const TOOL_RESULT_CAP_BYTES = 6_000;

const PROVIDER_INFO = {
  id: "gemini-web" as const,
  name: "Gemini (web session)",
  defaultModel: DEFAULT_MODEL,
  supportsStreaming: true,
  // True by default (the bridge), false when the user opts out. Nothing
  // upstream currently gates on this — the loop passes tools and the
  // opted-out path discards them — but the flag should not lie to pickers.
  get supportsTools(): boolean {
    return loadGeminiWebSettings().experimentalTools;
  },
  maxOutputTokens: 4096,
  // The budget here is requests, not tokens: the session is throttled, and
  // empty replies were measured at 3/5 back-to-back versus 1/4 with 25s of
  // spacing. Every background call is therefore a turn the user does not get.
  // Measured on this provider, one `freecode run` cost two requests — the turn
  // itself, then memory extraction on the way out.
  auxiliaryCalls: false,
  // Authenticated by a browser session cookie, or not at all. Without this the
  // model picker reads "no key on file" as "not configured" and makes the user
  // invent one before it will let them select the provider.
  requiresApiKey: false,
};

/** Text of a message. Tool and image parts are dropped rather than rendered —
 *  the default path never produces them, and a resumed session that carries
 *  them should not start narrating a tool history the model cannot act on. */
function textOf(message: Message): string {
  return message.parts
    .map((part: MessagePart) =>
      part.type === "text"
        ? part.content
        : part.type === "code"
          ? `\`\`\`${part.language}\n${part.content}\n\`\`\``
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** Tool-mode rendering of one assistant message: its text, then its calls in
 *  the same [TOOL_CALLS] wire format the model emits (so the transcript
 *  doubles as a few-shot example), then each result under an unlabelled
 *  heading — unlabelled text reads as the environment speaking, which is what
 *  a result is. `keepResult` is the newest-first budget decision. */
function renderToolTurn(
  message: Message,
  keepResult: (part: Extract<MessagePart, { type: "tool" }>) => boolean,
): string {
  const toolParts = message.parts.filter(
    (p): p is Extract<MessagePart, { type: "tool" }> => p.type === "tool",
  );
  if (toolParts.length === 0) return `[Assistant]: ${textOf(message)}`;

  const lines = toolParts.map(
    (p) => `${p.tool.tool}:${JSON.stringify(p.tool.args ?? {})}`,
  );
  const pieces = [
    `[Assistant]: ${textOf(message)}\n[TOOL_CALLS]\n${lines.join("\n")}\n[/TOOL_CALLS]`,
  ];
  for (const part of toolParts) {
    const result = part.result ?? "(no output)";
    if (!keepResult(part)) {
      pieces.push(`[Tool result for ${part.tool.tool}]: omitted — older result over the transcript budget`);
      continue;
    }
    const capped =
      result.length > TOOL_RESULT_CAP_BYTES
        ? result.slice(0, TOOL_RESULT_CAP_BYTES) +
          "\n… [truncated: result is larger than the transcript budget]"
        : result;
    pieces.push(`[Tool result for ${part.tool.tool}]:\n${capped}`);
  }
  return pieces.join("\n\n");
}

/** Newest-first budget over every tool result in the conversation: parts keep
 *  their bytes until the budget runs out, then older results collapse. */
function planResultBudget(
  messages: Message[],
): (part: Extract<MessagePart, { type: "tool" }>) => boolean {
  const kept = new Set<MessagePart>();
  let remaining = TOOL_RESULT_BUDGET_BYTES;
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i].parts) {
      if (part.type !== "tool") continue;
      const size = Math.min(
        (part.result ?? "").length,
        TOOL_RESULT_CAP_BYTES,
      );
      if (size <= remaining) {
        kept.add(part);
        remaining -= size;
      }
    }
  }
  return (part) => kept.has(part);
}

/** History as plain text, with every file the conversation has mentioned
 *  inlined ONCE, appended to the newest user message.
 *
 *  Not "mentions in the newest message only", which is what this did first: the
 *  transport keeps no server-side thread, so a file named on turn 1 is simply
 *  gone by turn 2 — measured, the follow-up turn dropped to 634 bytes and the
 *  model correctly answered that it had never been shown the file. Not "expand
 *  in place" either, which re-sends the same bytes once per turn that mentioned
 *  them. Collected newest-first so that when the budget runs out it is the
 *  stalest file that gets dropped, not the one just asked about. */
export function buildPrompt(messages: Message[], tools?: ToolDef[]): string {
  // The loop prepends a synthetic message carrying the file tree, git head and
  // clock. It is the single largest contributor to the 100 KB measured above
  // and answers nothing here: on the default path files arrive by name, and on
  // the tool path the model has glob/ls for discovery.
  const usable = messages.filter((m) => m.id !== "dynamic-context");
  const lastUserIndex = usable.map((m) => m.role).lastIndexOf("user");

  const mentions: string[] = [];
  for (let i = usable.length - 1; i >= 0; i--) {
    if (usable[i].role !== "user") continue;
    for (const mention of findMentions(textOf(usable[i]))) {
      if (!mentions.includes(mention)) mentions.push(mention);
    }
  }
  const { block } = inlineFiles(mentions);

  const withTools = tools !== undefined && tools.length > 0;
  const system = withTools
    ? buildToolProtocol(tools)
    : SYSTEM_PROMPT;
  const keepResult = withTools ? planResultBudget(usable) : () => false;

  // The endpoint takes ONE string, so roles are rendered as labels. Only the
  // assistant is labelled: an unlabelled paragraph reads as the user speaking,
  // which is what the model should treat as the live instruction.
  const parts = [`[System instruction]: ${system}`];
  usable.forEach((message, index) => {
    if (withTools && message.role === "assistant") {
      const rendered = renderToolTurn(message, keepResult);
      if (rendered !== "[Assistant]: ") parts.push(rendered);
      return;
    }
    let text = textOf(message);
    if (index === lastUserIndex && block) text = `${text}\n\n${block}`;
    if (!text) return;
    parts.push(message.role === "assistant" ? `[Assistant]: ${text}` : text);
  });
  return parts.join("\n\n");
}

function createGeminiWebProvider(_apiKey: string): AIProvider {
  // With the bridge opted out, `opts.system` and `opts.tools` are received
  // and discarded — see the header. Bare `opts.prompt` is the internal
  // callers' path (memory extraction, title generation), never the agent
  // loop's; mentions are NOT expanded there, and tools never apply there.
  function bridgeTools(opts: ExecuteOptions): ToolDef[] | undefined {
    if (!opts.messages || !opts.tools?.length) return undefined;
    return loadGeminiWebSettings().experimentalTools ? opts.tools : undefined;
  }

  function promptFor(opts: ExecuteOptions, tools?: ToolDef[]): string {
    return opts.messages
      ? buildPrompt(opts.messages, tools)
      : (opts.prompt ?? "");
  }

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = resolveGeminiWebModel(opts.model).name;
    const tools = bridgeTools(opts);
    const prompt = promptFor(opts, tools);
    const request = {
      model: opts.model,
      signal: opts.abortSignal,
      retryEmpty: tools !== undefined,
      minGapMs: tools !== undefined ? TOOL_REQUEST_GAP_MS : undefined,
    };

    let content = await generate({ prompt, ...request });
    if (tools === undefined) {
      return { content, stopReason: "stop", provider: PROVIDER_INFO.id, model };
    }

    let parsed = parseReply(content);
    if (parsed.violation) {
      // One corrective round trip, not a loop: every retry is a full request
      // against the session's quota (E3), and a model that violates twice is
      // better surfaced than silently hammered.
      logger.debug(`[gemini-web] protocol violation: ${parsed.violation}`);
      content = await generate({
        prompt: `${prompt}\n\n${correctionPrompt(content, parsed.violation)}`,
        ...request,
      });
      parsed = parseReply(content);
      if (parsed.violation) {
        logger.warn(
          `[gemini-web] protocol violation after correction: ${parsed.violation}`,
        );
      }
    }
    return {
      // A still-violating reply is shown as-is: visible beats vanished.
      content: parsed.content,
      toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
      stopReason: parsed.toolCalls.length > 0 ? "tool_use" : "stop",
      // No usage, deliberately. The web endpoint reports no token counts at
      // all, and the obvious stand-in (characters ÷ 4) would flow into the
      // daily tracker and context meter as though it were measured. Absent
      // beats invented; compaction estimates locally anyway.
      provider: PROVIDER_INFO.id,
      model,
    };
  }

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    try {
      const tools = bridgeTools(opts);
      const prompt = promptFor(opts, tools);

      if (tools === undefined) {
        for await (const delta of generateStream({
          prompt,
          model: opts.model,
          signal: opts.abortSignal,
        })) {
          yield { type: "text_delta", delta };
        }
        yield { type: "done", stopReason: "stop" };
        return;
      }

      // Tool mode: the gate withholds text until the reply classifies as
      // FINAL (streams live) or a tool block (never streams), so a violating
      // reply can be re-prompted before anything reached the screen.
      const request = {
        model: opts.model,
        signal: opts.abortSignal,
        retryEmpty: true,
        minGapMs: TOOL_REQUEST_GAP_MS,
      };
      const gate = new StreamGate();
      for await (const delta of generateStream({ prompt, ...request })) {
        const out = gate.push(delta);
        if (out) yield { type: "text_delta", delta: out };
      }
      const tail = gate.finish();
      if (tail) yield { type: "text_delta", delta: tail };

      let parsed = parseReply(gate.full);
      if (parsed.violation && !gate.emitted) {
        logger.debug(`[gemini-web] protocol violation: ${parsed.violation}`);
        const retry = await generate({
          prompt: `${prompt}\n\n${correctionPrompt(gate.full, parsed.violation)}`,
          ...request,
        });
        parsed = parseReply(retry);
        if (parsed.violation) {
          logger.warn(
            `[gemini-web] protocol violation after correction: ${parsed.violation}`,
          );
        }
        // The retry ran non-streaming; surface whatever text it produced.
        if (parsed.content) {
          yield { type: "text_delta", delta: parsed.content };
        }
      }
      for (const call of parsed.toolCalls) {
        yield { type: "tool_call", id: call.id, name: call.name, args: call.args };
      }
      yield {
        type: "done",
        stopReason: parsed.toolCalls.length > 0 ? "tool_use" : "stop",
      };
    } catch (error) {
      // Surfaced as a chunk rather than thrown: the loop renders an `error`
      // chunk in place, where a throw out of the generator kills the turn.
      yield { type: "error", error: String(error) };
    }
  }

  return { info: PROVIDER_INFO, execute, stream };
}

registerProvider("gemini-web", {
  info: PROVIDER_INFO,
  create: createGeminiWebProvider,
});
