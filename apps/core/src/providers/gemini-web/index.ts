// =============================================================================
// Gemini via a logged-in web session — ask/review mode.
//
// Drives a signed-in (or anonymous) gemini.google.com session as a provider,
// so a session can run on a free web account instead of a metered API key.
// Speaks Gemini's internal batchexecute RPC directly — see protocol.ts and
// client.ts. No sidecar, no SDK, no extra dependency: fetch and a sha1.
//
// This provider deliberately sends NO TOOLS, and it is not an oversight.
// Measured over 9 real turns of the agent loop, the session emitted a tool
// call ~56% of the time. The other 44% it answered from priors with total
// fluency — inventing file contents, and once replying to "what is the first
// line of TRACE.md" with US Census population statistics. A backend that
// silently fabricates on half its turns is worse than one that errors.
//
// Three arms were measured on one task ("quote the first line of TRACE.md"):
//
//   minimal system prompt + read tool    1.8 KB    5/9 called the tool
//   full freecode system prompt + 16 tools  100.7 KB  5/9 correct
//   no tools, file contents inlined      9.8 KB    4/4 correct, 0 empty
//
// Shrinking the prompt 55× and cutting 16 tools to 1 changed nothing. Removing
// the *need* for a tool call fixed it. So the design is: the user names files
// with @mentions, core reads them (inline.ts), and the model only ever does
// the thing it is reliable at — reading text that is already in front of it.
//
// The corollary is that this provider cannot edit, run, or search anything,
// which is why it needs no mode gating: with no tools on the wire there is
// nothing for a permission profile to deny.
// =============================================================================

import type { Message, MessagePart } from "../../agent/types.js";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
} from "../types.js";
import { registerProvider } from "../registry.js";
import { findMentions, inlineFiles } from "./inline.js";
import { generate, generateStream } from "./client.js";
import { DEFAULT_MODEL, resolveGeminiWebModel } from "./models.js";

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

const PROVIDER_INFO = {
  id: "gemini-web" as const,
  name: "Gemini (web session, ask/review)",
  defaultModel: DEFAULT_MODEL,
  supportsStreaming: true,
  // No tools reach the wire. Declared false so nothing upstream builds a tool
  // set for this provider expecting it to be honoured.
  supportsTools: false,
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
 *  this provider never produces them, and a resumed session that carries them
 *  should not start narrating a tool history the model cannot act on. */
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
export function buildPrompt(messages: Message[]): string {
  // The loop prepends a synthetic message carrying the file tree, git head and
  // clock. It is the single largest contributor to the 100 KB measured above
  // and answers nothing here, since the files come in by name.
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

  // The endpoint takes ONE string, so roles are rendered as labels. Only the
  // assistant is labelled: an unlabelled paragraph reads as the user speaking,
  // which is what the model should treat as the live instruction.
  const parts = [`[System instruction]: ${SYSTEM_PROMPT}`];
  usable.forEach((message, index) => {
    let text = textOf(message);
    if (index === lastUserIndex && block) text = `${text}\n\n${block}`;
    if (!text) return;
    parts.push(message.role === "assistant" ? `[Assistant]: ${text}` : text);
  });
  return parts.join("\n\n");
}

function createGeminiWebProvider(_apiKey: string): AIProvider {
  // `opts.system` and `opts.tools` are received and discarded — see the header.
  // Bare `opts.prompt` is the internal callers' path (memory extraction, title
  // generation), never the agent loop's; mentions are NOT expanded there, since
  // an extraction prompt quoting "@foo" is not a request to read foo.
  function promptFor(opts: ExecuteOptions): string {
    return opts.messages ? buildPrompt(opts.messages) : (opts.prompt ?? "");
  }

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = resolveGeminiWebModel(opts.model).name;
    const content = await generate({
      prompt: promptFor(opts),
      model: opts.model,
      signal: opts.abortSignal,
    });
    return {
      content,
      // No usage, deliberately. The web endpoint reports no token counts at
      // all, and the obvious stand-in (characters ÷ 4) would flow into the
      // daily tracker and context meter as though it were measured. Absent
      // beats invented; compaction estimates locally anyway.
      stopReason: "stop",
      provider: PROVIDER_INFO.id,
      model,
    };
  }

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    try {
      for await (const delta of generateStream({
        prompt: promptFor(opts),
        model: opts.model,
        signal: opts.abortSignal,
      })) {
        yield { type: "text_delta", delta };
      }
      yield { type: "done", stopReason: "stop" };
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
