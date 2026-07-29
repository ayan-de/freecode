export interface LogicalPos {
  lineIndex: number;
  column: number;
}

export interface Selection {
  anchor: LogicalPos;
  cursor: LogicalPos;
}

export interface NormalizedRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export function normalize(sel: Selection): NormalizedRange {
  const { anchor, cursor } = sel;
  const anchorFirst =
    anchor.lineIndex < cursor.lineIndex ||
    (anchor.lineIndex === cursor.lineIndex && anchor.column <= cursor.column);
  const [start, end] = anchorFirst ? [anchor, cursor] : [cursor, anchor];
  return {
    startLine: start.lineIndex,
    startCol: start.column,
    endLine: end.lineIndex,
    endCol: end.column,
  };
}

export class SelectionStore {
  private selection: Selection | null = null;

  begin(pos: LogicalPos): void {
    this.selection = { anchor: pos, cursor: pos };
  }

  update(pos: LogicalPos): void {
    if (!this.selection) return;
    this.selection = { anchor: this.selection.anchor, cursor: pos };
  }

  clear(): void {
    this.selection = null;
  }

  get(): Selection | null {
    return this.selection;
  }

  /** A click (as opposed to a drag) if start/end land on the same line and
   * column — matches normal text-select "clicking does nothing new" behavior. */
  isNearZeroDrag(a: LogicalPos, b: LogicalPos): boolean {
    return a.lineIndex === b.lineIndex && Math.abs(a.column - b.column) <= 0;
  }
}
