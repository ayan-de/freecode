// =============================================================================
// Oscillation Detection - edit/revert/edit cycles
// PRIMARY: tell a stuck loop apart from legitimate repeated work.
// Editing one file many times is normal for a long task (a feature file gets
// built up over dozens of turns), so counting edits per path flags real work
// as a loop. What actually signals oscillation is an edit that *undoes* an
// earlier one: X→Y followed by Y→X. Comparing the two sides of each edit
// catches that without reading the file back off disk.
// =============================================================================

import { createHash } from "crypto";

// How many recent edits to keep when looking for an inverse. A revert lands
// near its original edit in practice, and the window bounds memory on long runs.
export const RECENT_EDIT_WINDOW = 30;

// One edit as a content transition: the file went `from` one state `to` another.
// Both sides are hashed so a long run doesn't retain every edited string.
export interface EditTransition {
  file: string;
  from: string;
  to: string;
}

const hashSide = (value: string): string =>
  createHash("sha1").update(value).digest("hex");

export function toEditTransition(
  file: string,
  oldString: string,
  newString: string,
): EditTransition {
  return { file, from: hashSide(oldString), to: hashSide(newString) };
}

// True when `edit` inverts an earlier edit to the same file — it puts back
// exactly what that edit replaced. A no-op edit (from === to) changes nothing
// and is never counted.
export function isRevert(
  recent: readonly EditTransition[],
  edit: EditTransition,
): boolean {
  if (edit.from === edit.to) return false;
  return recent.some(
    (prior) =>
      prior.file === edit.file &&
      prior.from === edit.to &&
      prior.to === edit.from,
  );
}
