// =============================================================================
// Browser Chat — SSE framing
//
// The in-page bridge stays dumb: it forwards raw response text. All framing
// and decoding happens here, in Node, where it is unit-testable offline
// (spec, Testing strategy).
// =============================================================================

/**
 * Splits a byte-stream-shaped sequence of string chunks into complete SSE
 * frames. Network chunks split anywhere — mid-frame, mid-UTF8-sequence, mid
 * "\n\n" — so the splitter is stateful and only emits whole frames.
 */
export function createSseSplitter(): (chunk: string) => string[] {
  let buffer = "";
  return (chunk: string): string[] => {
    buffer += chunk;
    const frames: string[] = [];
    // SSE frames are separated by a blank line; tolerate \r\n from proxies.
    const separator = /\r?\n\r?\n/;
    let match = separator.exec(buffer);
    while (match) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (frame.trim().length > 0) frames.push(frame);
      match = separator.exec(buffer);
    }
    return frames;
  };
}

export interface SseFrame {
  event?: string;
  /** Concatenated `data:` lines, per the SSE spec. */
  data: string;
}

export function parseSseFrame(frame: string): SseFrame {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // A single leading space after the colon is part of the framing, not data.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  return { event, data: dataLines.join("\n") };
}

/** Best-effort JSON parse — a non-JSON data payload is not an error. */
export function parseFrameJson(frame: SseFrame): unknown | null {
  if (frame.data.length === 0 || frame.data === "[DONE]") return null;
  try {
    return JSON.parse(frame.data);
  } catch {
    return null;
  }
}
