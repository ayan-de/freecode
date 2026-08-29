// =============================================================================
// Gemini web session — response parsing
//
// The endpoint answers with Google's chunked batchexecute framing:
//
//   )]}'
//   <byte count>
//   [["wrb.fr",null,"<JSON string>"]]
//   <byte count>
//   [["wrb.fr",null,"<JSON string>"]]        ← same reply, longer
//
// Each frame carries the WHOLE reply so far, not a delta, and frames repeat as
// the model writes. So "the answer" is the longest text seen, and a streaming
// delta is whatever the newest frame adds to the last one emitted.
// =============================================================================

/** Frames shorter than this are envelope-only (ids, metadata), never text. */
const MIN_FRAME_LENGTH = 200;
const MIN_PAYLOAD_LENGTH = 50;

// Gemini inlines its own tooling artefacts into the markdown: code-execution
// echo blocks, and card links pointing at googleusercontent. Neither means
// anything outside the web UI.
const CODE_ARTEFACT =
  /```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g;
const CARD_LINK = /http:\/\/googleusercontent\.com\/card_content\/\d+\n?/g;

export function cleanText(text: string, trim = true): string {
  const cleaned = text.replace(CODE_ARTEFACT, "").replace(CARD_LINK, "");
  return trim ? cleaned.trim() : cleaned;
}

/**
 * An upstream rejection arrives as a marker inside the body with a 200 status,
 * so it has to be sniffed rather than read off the response code.
 */
export function findUpstreamError(raw: string): string | undefined {
  const match = raw.match(/BardErrorInfo\s*\[(\d+)\]/);
  return match ? `Gemini rejected the request (BardErrorInfo [${match[1]}])` : undefined;
}

/** Every candidate text carried by one framing line. */
export function textsInLine(line: string): string[] {
  if (!line.includes('"wrb.fr"') || line.length < MIN_FRAME_LENGTH) return [];
  try {
    const outer = JSON.parse(line) as unknown[][];
    const payload = outer[0]?.[2];
    if (typeof payload !== "string" || payload.length < MIN_PAYLOAD_LENGTH) {
      return [];
    }
    const inner = JSON.parse(payload) as unknown[];
    const candidates = inner[4];
    if (!Array.isArray(candidates)) return [];

    const texts: string[] = [];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      const parts = candidate[1];
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (typeof part === "string" && part) texts.push(part);
      }
    }
    return texts;
  } catch {
    // A frame we cannot parse is skipped, not fatal: the next frame carries the
    // whole reply again, so one bad frame costs nothing.
    return [];
  }
}

/** The complete reply from a whole response body. */
export function extractResponseText(raw: string): string {
  const error = findUpstreamError(raw);
  if (error) throw new Error(error);

  let longest = "";
  for (const line of raw.split("\n")) {
    for (const text of textsInLine(line)) {
      if (text.length > longest.length) longest = text;
    }
  }
  return cleanText(longest);
}

/**
 * Folds framing lines into incremental deltas.
 *
 * Frames are cumulative and repeat, so this emits only what is new. A frame
 * that is not an extension of what was already emitted means the model
 * restarted its answer (a retry upstream); reporting that is better than
 * emitting text that contradicts what the user already read.
 */
export class DeltaFold {
  private emitted = "";

  push(line: string): string | undefined {
    for (const text of textsInLine(line)) {
      if (text === this.emitted || this.emitted.startsWith(text)) continue;
      if (!text.startsWith(this.emitted)) {
        throw new Error("Gemini restarted the reply mid-stream");
      }
      const delta = cleanText(text.slice(this.emitted.length), false);
      this.emitted = text;
      if (delta) return delta;
    }
    return undefined;
  }

  get text(): string {
    return cleanText(this.emitted);
  }
}
