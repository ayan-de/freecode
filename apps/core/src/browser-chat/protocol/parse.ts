// =============================================================================
// Browser Chat — reply parsing
//
// STRICT PROMPT, LENIENT PARSER (spec, Postel's law). The bootstrap demands
// exactly one `~~~freecode` block and nothing else, but the single most likely
// deviation is a correct block wearing the wrong costume — a ```json fence, a
// preamble, a trailing "want me to continue?". Making the parser strict about
// that would turn the most likely deviation into a round trip, which is the
// expensive unit in browser mode. So we recognise the costumes.
// =============================================================================

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ProtocolViolation = "bad-json" | "bad-shape";

export interface ParsedReply {
  /** Prose with the protocol block removed. */
  text: string;
  toolCalls: ParsedToolCall[];
  /**
   * Set only when something block-shaped was found but could not be used. A
   * reply with no block at all is a normal assistant answer, not a violation.
   */
  violation?: ProtocolViolation;
  /** Which fence variant matched — reported by doctor for compliance stats. */
  matchedFence?: string;
}

interface Candidate {
  body: string;
  start: number;
  end: number;
  fence: string;
}

// Ordered by how much we trust them. `~~~freecode` is what we ask for.
const FENCE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "~~~freecode", regex: /~~~[ \t]*freecode[^\n]*\n([\s\S]*?)~~~/ },
  { name: "```freecode", regex: /```[ \t]*freecode[^\n]*\n([\s\S]*?)```/ },
  { name: "```json", regex: /```[ \t]*json[^\n]*\n([\s\S]*?)```/ },
  { name: "```", regex: /```[^\n]*\n([\s\S]*?)```/ },
];

function findFenced(markdown: string): Candidate | null {
  for (const { name, regex } of FENCE_PATTERNS) {
    const match = regex.exec(markdown);
    if (match && match[1].includes('"calls"')) {
      return {
        body: match[1],
        start: match.index,
        end: match.index + match[0].length,
        fence: name,
      };
    }
  }
  return null;
}

/** Bare `{"calls": …}` with no fence at all. Balanced-brace scan. */
function findBare(markdown: string): Candidate | null {
  const start = markdown.indexOf('{"calls"');
  const loose = start === -1 ? markdown.search(/\{\s*"calls"/) : start;
  if (loose === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = loose; i < markdown.length; i++) {
    const ch = markdown[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return {
          body: markdown.slice(loose, i + 1),
          start: loose,
          end: i + 1,
          fence: "bare",
        };
      }
    }
  }
  return null;
}

function coerceCalls(payload: unknown): ParsedToolCall[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const calls = (payload as { calls?: unknown }).calls;
  if (!Array.isArray(calls)) return null;

  const result: ParsedToolCall[] = [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (typeof call !== "object" || call === null) return null;
    const { id, name, args } = call as Record<string, unknown>;
    if (typeof name !== "string" || name.length === 0) return null;
    result.push({
      // The model omitting ids is not worth a round trip — synthesize them.
      id: typeof id === "string" && id.length > 0 ? id : `call-${i + 1}`,
      name,
      args:
        typeof args === "object" && args !== null
          ? (args as Record<string, unknown>)
          : {},
    });
  }
  return result;
}

export function parseReply(markdown: string): ParsedReply {
  const candidate = findFenced(markdown) ?? findBare(markdown);
  if (!candidate) {
    // No block: a plain answer. Ends the turn, and is not a violation.
    return { text: markdown.trim(), toolCalls: [] };
  }

  const stripped = (
    markdown.slice(0, candidate.start) + markdown.slice(candidate.end)
  ).trim();

  let payload: unknown;
  try {
    payload = JSON.parse(candidate.body.trim());
  } catch {
    return {
      text: stripped,
      toolCalls: [],
      violation: "bad-json",
      matchedFence: candidate.fence,
    };
  }

  const calls = coerceCalls(payload);
  if (!calls) {
    return {
      text: stripped,
      toolCalls: [],
      violation: "bad-shape",
      matchedFence: candidate.fence,
    };
  }

  return { text: stripped, toolCalls: calls, matchedFence: candidate.fence };
}
