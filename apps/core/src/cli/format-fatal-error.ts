// Turns an uncaught error into one clean line for the terminal.
//
// Without this, an AI_APICallError (or any Error the AI SDK throws) that
// escapes every try/catch hits Node/Bun's default inspector, which dumps
// every enumerable field the SDK attaches (requestBodyValues, responseBody,
// responseHeaders, cause) plus a pretty-printed stack — in the bundled
// binary that stack shows minified source context lines, not a readable
// trace. `err.message` alone is already the clean provider-supplied text
// (e.g. "The server cluster is currently under high load... (529)").
import { APICallError } from "ai";

export function formatFatalError(err: unknown): string {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ? ` (${err.statusCode})` : "";
    return `${err.message}${status}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * True for an AI SDK APICallError — the case formatFatalError exists to
 * clean up. Exported so callers that want a stack trace for anything else
 * (e.g. the TUI's crash report, which needs one for real bugs) can special-case
 * just this type instead of importing `ai` themselves.
 */
export function isProviderError(err: unknown): boolean {
  return APICallError.isInstance(err);
}
