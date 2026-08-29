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

import type { Message } from "../../agent/types.js";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
} from "../types.js";
import { registerProvider } from "../registry.js";
import {
  ASK_REVIEW_SYSTEM_PROMPT,
  flattenConversation,
} from "../web-session/prompt.js";
import { generate, generateStream } from "./client.js";
import { DEFAULT_MODEL, resolveGeminiWebModel } from "./models.js";

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

// Gemini's endpoint rejects payloads somewhere past ~60 KB, so the inlining
// budget leaves room for the preamble, the history and the reply.
const INLINE_BUDGET_BYTES = 45_000;

function buildPrompt(messages: Message[]): string {
  return flattenConversation(messages, {
    system: ASK_REVIEW_SYSTEM_PROMPT,
    budgetBytes: INLINE_BUDGET_BYTES,
  });
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
