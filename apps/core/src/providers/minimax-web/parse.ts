// =============================================================================
// MiniMax web session — SSE event folding
//
// The stream is Server-Sent Events. The one event that carries text is
// `message_result`, whose `content` is the WHOLE reply so far, not a delta —
// the same cumulative shape gemini-web's frames use. `isEnd === 0` marks the
// final event (0 means "ended", not "not ended").
//
// The reference implementation sliced each chunk against `text.indexOf('')`
// with an EMPTY string literal, which is always 0, so its chunk was always the
// empty string. Slicing against what has already been emitted is what it was
// evidently meant to do, and is what happens here.
// =============================================================================

export interface MiniMaxEvent {
  event?: string;
  data: string;
}

export interface FoldResult {
  delta?: string;
  done: boolean;
  chatId?: number;
}

/** Splits an SSE buffer into complete events, returning the unconsumed tail. */
export function splitEvents(buffer: string): {
  events: MiniMaxEvent[];
  rest: string;
} {
  const events: MiniMaxEvent[] = [];
  let rest = buffer;

  let boundary: number;
  while ((boundary = rest.indexOf("\n\n")) !== -1) {
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);

    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join("\n") });
    }
  }
  return { events, rest };
}

/**
 * Accumulates cumulative `message_result` payloads into deltas.
 *
 * An event whose content is not an extension of what was already emitted means
 * the model restarted; that is reported rather than emitted, because showing it
 * would contradict text the user has already read.
 */
export class MiniMaxFold {
  private emitted = "";
  chatId?: number;

  push(event: MiniMaxEvent): FoldResult {
    let parsed: any;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      // A frame we cannot parse is skipped, not fatal — the next one carries
      // the whole reply again.
      return { done: false };
    }

    const status = parsed?.base_resp?.status_code ?? parsed?.statusInfo?.code;
    const message = parsed?.base_resp?.status_msg ?? parsed?.statusInfo?.message;
    if (typeof status === "number" && status !== 0) {
      throw new Error(`MiniMax rejected the request: ${message ?? status}`);
    }

    if (parsed?.chat_id && this.chatId === undefined) {
      this.chatId = parsed.chat_id;
    }

    const result = parsed?.data?.messageResult;
    if (!result) return { done: false };

    const chatId = result.chat_id ?? result.chatID;
    if (chatId !== undefined && this.chatId === undefined) this.chatId = chatId;

    const text: unknown = result.content;
    const done = result.isEnd === 0;
    if (typeof text !== "string" || text.length === 0) return { done };

    if (text === this.emitted || this.emitted.startsWith(text)) return { done };
    if (!text.startsWith(this.emitted)) {
      throw new Error("MiniMax restarted the reply mid-stream");
    }
    const delta = text.slice(this.emitted.length);
    this.emitted = text;
    return { delta, done, chatId: this.chatId };
  }

  get text(): string {
    return this.emitted;
  }
}
