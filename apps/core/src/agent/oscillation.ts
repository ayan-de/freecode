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

// An edit kept in the rolling window, tagged with whether it undid an earlier
// edit that was still inside the window when it landed.
export interface RecordedEdit extends EditTransition {
  reverted: boolean;
}

// Append `edit` to the window and drop whatever aged out of it.
export function recordEdit(
  window: readonly RecordedEdit[],
  edit: EditTransition,
): RecordedEdit[] {
  const next = [...window, { ...edit, reverted: isRevert(window, edit) }];
  return next.length > RECENT_EDIT_WINDOW
    ? next.slice(next.length - RECENT_EDIT_WINDOW)
    : next;
}

// The oscillation score: reverts still inside the window. Deriving it from the
// window rather than a running counter is what lets it fall again — one genuine
// edit/revert pair early in a long session used to leave the counter armed for
// the rest of the run, so every later iteration evaluated as a warning.
export const countReverts = (window: readonly RecordedEdit[]): number =>
  window.reduce((n, e) => n + (e.reverted ? 1 : 0), 0);
