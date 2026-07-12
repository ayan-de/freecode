// =============================================================================
// Tool batching plan
// Groups a sequence of tool calls into batches that can run in parallel.
// A batch is parallel iff every tool in it has behavior.isConcurrencySafe = true.
// Sequential tools (or tools whose behavior is unknown) always occupy their own
// batch so ordering guarantees around writes/edits/shell are preserved.
// =============================================================================

import { getTool } from "./index.js";

export interface ToolBatch {
  start: number;
  end: number;
  parallel: boolean;
}

export type IsConcurrencySafeFn = (toolName: string) => boolean;

const defaultIsSafe: IsConcurrencySafeFn = (name) =>
  getTool(name)?.behavior?.isConcurrencySafe === true;

export function planToolBatches<T extends { tool: string }>(
  toolCalls: readonly T[],
  isSafe: IsConcurrencySafeFn = defaultIsSafe,
): ToolBatch[] {
  const batches: ToolBatch[] = [];
  let i = 0;
  while (i < toolCalls.length) {
    const startSafe = isSafe(toolCalls[i].tool);
    let j = i + 1;
    if (startSafe) {
      while (j < toolCalls.length && isSafe(toolCalls[j].tool)) j++;
    }
    batches.push({ start: i, end: j, parallel: startSafe && j - i > 1 });
    i = j;
  }
  return batches;
}
