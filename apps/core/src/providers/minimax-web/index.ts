// =============================================================================
// MiniMax via a logged-in web session — ask/review mode.
//
// Drives agent.minimaxi.com as a provider, so a session can run on a MiniMax
// web account instead of a metered key. Distinct from the existing `minimax`
// provider, which is the paid Anthropic-compatible API — same vendor, different
// endpoint, different credential, and they must not share an id.
//
// Same shape as gemini-web and for the same measured reason: no tools, files
// arrive by @mention, the reply is prose. See web-session/prompt.ts.
//
// UNVALIDATED AGAINST THE LIVE SERVICE. The protocol is ported from a working
// reference client, and the signing and SSE folding are unit-tested, but every
// call needs a JWT from a signed-in browser tab and no such token was available
// while writing this. The device-registration round trip was confirmed to reach
// the real endpoint and be rejected on auth, which proves the transport and
// signature envelope but not the chat path.
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
import { DEFAULT_MODEL } from "./models.js";

const PROVIDER_INFO = {
  id: "minimax-web" as const,
  name: "MiniMax (web session, ask/review)",
  defaultModel: DEFAULT_MODEL,
  supportsStreaming: true,
  // No tools reach the wire — see web-session/prompt.ts for the measurements.
  supportsTools: false,
  maxOutputTokens: 4096,
  // Budget is a request quota, not tokens: every background call is a turn the
  // user does not get.
  auxiliaryCalls: false,
  // Unlike gemini-web there is no anonymous mode — a JWT is mandatory, so the
  // picker's key prompt is exactly the right behaviour here.
  requiresApiKey: true,
};

// Unmeasured, unlike gemini-web's 45 KB. Chosen as a conservative default until
// someone with a token finds the real ceiling; too small only means a large
// file is reported truncated, which is visible, rather than a request that is
// silently rejected.
const INLINE_BUDGET_BYTES = 30_000;

function buildPrompt(messages: Message[]): string {
  return flattenConversation(messages, {
    system: ASK_REVIEW_SYSTEM_PROMPT,
    budgetBytes: INLINE_BUDGET_BYTES,
  });
}

function createMiniMaxWebProvider(_apiKey: string): AIProvider {
  // Bare `opts.prompt` is the internal callers' path (memory extraction, title
  // generation), never the agent loop's; mentions are NOT expanded there.
  function promptFor(opts: ExecuteOptions): string {
    return opts.messages ? buildPrompt(opts.messages) : (opts.prompt ?? "");
  }

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const content = await generate({
      prompt: promptFor(opts),
      signal: opts.abortSignal,
    });
    return {
      content,
      // No usage: the endpoint reports no token counts, and a chars ÷ 4
      // stand-in would reach the daily tracker looking measured.
      stopReason: "stop",
      provider: PROVIDER_INFO.id,
      model: opts.model || DEFAULT_MODEL,
    };
  }

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    try {
      for await (const delta of generateStream({
        prompt: promptFor(opts),
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

registerProvider("minimax-web", {
  info: PROVIDER_INFO,
  create: createMiniMaxWebProvider,
});
