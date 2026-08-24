import {
  visibleWidth,
  truncateToWidth,
  wrapTextWithAnsi,
  CURSOR_MARKER,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { QuestionSpec } from "@thisisayande/freecode-shared";

// Card colors. Yellow accent matches the app theme (MODE_COLORS build/#FFD700).
const ACCENT = "#FFD700";
// The card itself is transparent; INPUT_BG is the only fill left, marking the
// inline "Other" field as an editable box.
const INPUT_BG = "#37373E";
const DIM = "#666666";
const MARKER = "#FFD700";

// Card geometry. Inner width is the space between the two `│` borders; the
// option content is laid out against this. The card width is hard-capped so
// on a full-screen terminal it doesn't sprawl.
const PAD_X_INNER = 4;
const MIN_INNER_WIDTH = 28;
const MAX_INNER_WIDTH = 78;
const MAX_VISIBLE_OPTIONS = 8;

// Synthetic free-text "Other" row appended to every question. It mirrors the
// tui-rs modal's "Other" option so the two frontends behave identically.
const OTHER_LABEL = "Other";
const OTHER_DESCRIPTION = "Type your own answer";

interface OptionRow {
  /** Display label (or OTHER_LABEL for the synthetic row). */
  label: string;
  /** Optional secondary line shown dim beneath the label. */
  description: string;
  /** True for the synthetic "Other" row at the end of the options. */
  isOther: boolean;
}

/** Where this modal sits in a multi-question request, plus any prior answer. */
export interface QuestionPosition {
  /** 0-based index of this question. */
  index: number;
  /** Total questions in the request. */
  total: number;
  /** Answer previously given for this question, restored on re-entry. */
  previousAnswer?: string;
}

/**
 * QuestionModal — the TS TUI analogue of the tui-rs PromptComponent.
 *
 * A centered overlay card that prompts the user with a question's options and
 * a synthetic "Other" free-text escape hatch. Renders the whole card itself
 * (border, title, row markers, inline editor) so the host only needs to mount
 * it via `tui.showOverlay(this, { anchor: "center" })`.
 *
 * Handle keys itself so the surrounding TUI doesn't need to know about the
 * modal's state. Two outcomes:
 *   - `onSelect` with a non-empty trimmed value (the chosen label, or the typed
 *     "Other" text). The caller advances to the next question or replies.
 *   - `onCancel` on Esc from the picker, or a blank "Other" submit. The caller
 *     rejects the whole question request.
 */
export class QuestionModal implements Component {
  private options: OptionRow[];
  private selected = 0;
  private editingOther = false;
  private otherText = "";

  constructor(
    private readonly title: string,
    private readonly question: string,
    private readonly optionsInput: QuestionSpec["options"],
    private readonly position?: QuestionPosition,
  ) {
    this.options = buildOptions(optionsInput);
    this.restoreAnswer(position?.previousAnswer);
  }

  /**
   * Put the cursor back where the user left it when they navigate back to an
   * already-answered question. A prior answer is either one of the option
   * labels, or free text typed into "Other" — in which case we select the
   * "Other" row and prefill the field (without reopening the editor).
   */
  private restoreAnswer(previous: string | undefined): void {
    if (!previous) return;
    const match = this.options.findIndex((o) => !o.isOther && o.label === previous);
    if (match >= 0) {
      this.selected = match;
      return;
    }
    const other = this.options.findIndex((o) => o.isOther);
    if (other >= 0) {
      this.selected = other;
      this.otherText = previous;
    }
  }

  /** `[2/3]` counter shown on the top border; empty for single questions. */
  private counterText(): string {
    if (!this.position || this.position.total <= 1) return "";
    return `[${this.position.index + 1}/${this.position.total}]`;
  }

  /** Preferred card width. The overlay can shrink this on narrow terminals. */
  width(): number {
    // The widest thing on screen usually isn't an option label — it's the
    // question text itself. Compute the question's widest rendered line at a
    // generous target width, then size the card so the question barely
    // wraps (≤ 2 lines). Options are picked up too as a floor.
    const widestOption = Math.max(
      OTHER_LABEL.length,
      ...this.options.map((o) => visibleWidth(o.label)),
      // Descriptions render on their own indented row (4 cols), so a long
      // description can be wider than any label — count it or it truncates.
      ...this.options.map((o) => (o.description ? visibleWidth(o.description) + 4 : 0)),
    );
    // Pick a generous width to let the question settle; visibleWidth on each
    // wrapped line gives the actual minimum width needed to render that line.
    const questionWidths = this.question
      ? wrapTextWithAnsi(this.question, MAX_INNER_WIDTH).map((l) =>
          visibleWidth(l),
        )
      : [0];
    const widestQuestionLine = Math.max(0, ...questionWidths);

    // Target the *smallest* width that lays out the question in ≤ 2 lines:
    // halve the longest line so each occupies ~one row. Fall back to the
    // option/Other floor for questions that already fit.
    // The top border carries " title " and, for multi-question requests, the
    // "[2/3]" counter. Both must fit or the counter gets squeezed off the row.
    const topBorder =
      visibleWidth(this.title || "Question") + 2 + visibleWidth(this.counterText());

    const target = Math.max(widestOption, topBorder, Math.ceil(widestQuestionLine / 2));
    const inner = Math.max(
      MIN_INNER_WIDTH,
      Math.min(MAX_INNER_WIDTH, target + PAD_X_INNER),
    );
    return inner + 2; // outer border
  }

  invalidate(): void {
    // No cached state — render is cheap.
  }

  /**
   * Render the card. The box is built row by row; every row is `width` columns
   * wide — padded with plain spaces, not a background fill — so the overlay
   * composite lands cleanly over the transcript. Side borders are drawn on the
   * first and last column of every interior row; the top/bottom rows get
   * rounded corners and a centered title.
   */
  render(width: number): string[] {
    // Clamp the inner width so a narrow terminal still renders cleanly.
    const inner = Math.max(4, width - 2);

    const accent = (s: string): string => chalk.hex(ACCENT)(s);
    const dim = (s: string): string => chalk.hex(DIM)(s);
    const left = accent("│");
    const right = accent("│");

    // Top: ╭─ <title> ─…─[2/3]─╮
    const titleText = ` ${this.title || "Question"} `;
    const titlePlain = visibleWidth(titleText);
    // Right end of the top row: just "╮", or "─[2/3]─╮" when the request has
    // more than one question. The counter doubles as the ←→ navigation
    // affordance, so it lives on the border rather than in the body.
    const counter = this.counterText();
    const tail = counter
      ? accent("─") +
        dim("[") +
        chalk.hex(ACCENT)(counter.slice(1, -1)) +
        dim("]") +
        accent("─╮")
      : accent("╮");
    const tailPlain = counter ? counter.length + 3 : 1;
    // `inner - titlePlain - tailPlain`: the top row is "╭─" + title + dashes +
    // tail, and must come out exactly `inner + 2` columns wide. The card
    // background used to hide a missing column; without a fill it reads as a
    // notch in the top-right corner.
    const topDashes = Math.max(0, inner - titlePlain - tailPlain);
    const top =
      accent("╭─") + chalk.bold(titleText) + accent("─".repeat(topDashes)) + tail;

    // Bottom: ╰─…─╯
    const bottom = accent("╰" + "─".repeat(inner) + "╯");

    const rows: string[] = [top];

    // First interior row is a blank breathing line under the title.
    rows.push(blankRow(inner, left, right));

    // Question text — wrapped so a long question doesn't blow the card.
    if (this.question) {
      const wrapped = wrapTextWithAnsi(this.question, inner);
      for (const line of wrapped) {
        rows.push(row(line, inner, left, right, dim));
      }
      rows.push(blankRow(inner, left, right));
    }

    // Option list + (optional) inline "Other" field.
    rows.push(...this.renderOptions(inner, left, right, dim));

    // Hint line at the bottom of the card. The card is sized by its question
    // and options, not by the hint, so a narrow card takes a shorter variant
    // instead of a truncated one ending in "…".
    rows.push(row(dim(this.hintText(inner)), inner, left, right, dim));

    // Blank line above the bottom border.
    rows.push(blankRow(inner, left, right));

    rows.push(bottom);
    return rows;
  }

  /** Widest key hint that fits `inner`, longest first, shortest as a floor. */
  private hintText(inner: number): string {
    const nav = this.counterText() ? "←→ question · " : "";
    const variants = this.editingOther
      ? ["type your answer · enter submit · esc back", "enter submit · esc back"]
      : [
          `↑↓ move · ${nav}1-9 jump · enter select · esc cancel`,
          `↑↓ move · ${nav}enter select · esc cancel`,
          this.counterText() ? "↑↓ ←→ · enter · esc" : "↑↓ · enter · esc",
        ];
    return variants.find((h) => visibleWidth(h) <= inner) ?? variants[variants.length - 1];
  }

  /**
   * Render the option list. The "Other" row always appears last; when
   * `editingOther` is true we draw the inline text field directly under it.
   * Long lists scroll: a sliding window of MAX_VISIBLE_OPTIONS rows keeps the
   * selected row in view.
   */
  private renderOptions(
    inner: number,
    left: string,
    right: string,
    dim: (s: string) => string,
  ): string[] {
    const lines: string[] = [];
    const visible = Math.min(this.options.length, MAX_VISIBLE_OPTIONS);
    const start = clampWindowStart(this.selected, this.options.length, visible);

    if (this.options.length > visible && start > 0) {
      const label = `… +${start} more`;
      lines.push(row(label, inner, left, right, dim));
    }

    for (let i = start; i < Math.min(start + visible, this.options.length); i++) {
      const opt = this.options[i];
      const active = i === this.selected;
      const marker = chalk.hex(MARKER)(active ? "❯" : " ");
      const number = dim(`${i + 1}.`).padEnd(3);
      const prefix = `${marker} ${number} `;
      const prefixWidth = visibleWidth(prefix);
      const labelColorFn = active ? chalk.hex("#FFFFFF") : chalk.hex("#888888");

      // Wrap the label to the card width instead of truncating with "…".
      // Continuation lines align under the label, not the marker/number.
      const labelLines = wrapTextWithAnsi(opt.label, Math.max(1, inner - prefixWidth));
      labelLines.forEach((line, idx) => {
        const content = idx === 0 ? `${prefix}${labelColorFn(line)}` : `    ${labelColorFn(line)}`;
        lines.push(row(content, inner, left, right, dim));
      });

      if (opt.description) {
        const descLines = wrapTextWithAnsi(opt.description, Math.max(1, inner - 4));
        for (const line of descLines) {
          lines.push(row(`    ${line}`, inner, left, right, dim));
        }
      }

      // The "Other" row is the only one that opens an inline editor. Drawing
      // it directly under the marker mirrors the tui-rs modal.
      if (opt.isOther && this.editingOther) {
        lines.push(...this.renderOtherField(inner, left, right));
      }
    }

    if (this.options.length > visible && start + visible < this.options.length) {
      const label = `… +${this.options.length - start - visible} more`;
      lines.push(row(label, inner, left, right, dim));
    }
    return lines;
  }

  /**
   * Inline "Other" text field. Placeholder ("type your answer…") when empty,
   * the typed text otherwise, with a block cursor at the end. The whole
   * field sits on the lighter INPUT_BG so it reads as a raised input box.
   * Emits CURSOR_MARKER at the cursor position so pi-tui can place the
   * hardware cursor for IME use.
   */
  private renderOtherField(inner: number, left: string, right: string): string[] {
    const inputBg = (s: string): string => chalk.bgHex(INPUT_BG)(s);
    const prompt = chalk.hex(MARKER)("›");
    const cursor = chalk.hex(MARKER)("▏");
    const placeholder = chalk.hex("#555555")("type your answer…");
    const text = this.otherText.length > 0 ? this.otherText : placeholder;

    // The row is: left-border + "  " + "› " + text + cursor + padding + … +
    // right-border. The 2-col leading indent matches the tui-rs offset.
    const content = `  ${prompt} ${text}${cursor}`;

    // Two rows: the field row and a buffer row of the same background so the
    // input reads as a 2-line raised box, like the tui-rs modal.
    const fitted = truncateToWidth(content, inner);
    const pad = Math.max(0, inner - visibleWidth(fitted));
    const fieldRow = `${left}${inputBg(fitted)}${inputBg(" ".repeat(pad))}${right}`;
    const bufferRow = `${left}${inputBg(" ".repeat(inner))}${right}`;

    // When editing, append CURSOR_MARKER just after the cursor so the
    // hardware cursor lands inside the field. Emitted on the first row only.
    const marker = this.editingOther ? CURSOR_MARKER : "";
    return [`${fieldRow}${marker}`, bufferRow];
  }

  /**
   * Handle keys. The overlay stack routes input to the focused component;
   * pi-tui setFocus()es the overlay component when shown, so this is the
   * only `handleInput` we need.
   */
  handleInput(data: string): void {
    if (this.editingOther) {
      this.handleOtherInput(data);
      return;
    }
    this.handlePickerInput(data);
  }

  private handlePickerInput(data: string): void {
    // Arrow keys: ANSI up/down + a few legacy variants.
    if (data === "\x1b[A" || data === "\x1bOA" || data === "\x1b[A") {
      this.moveSelection(-1);
      return;
    }
    if (data === "\x1b[B" || data === "\x1bOB") {
      this.moveSelection(1);
      return;
    }
    // Left/right move between the questions of a multi-question request. The
    // caller owns the sequence, so we only report the direction.
    if (data === "\x1b[D" || data === "\x1bOD") {
      if (this.counterText()) this.onNavigate?.(-1);
      return;
    }
    if (data === "\x1b[C" || data === "\x1bOC") {
      if (this.counterText()) this.onNavigate?.(1);
      return;
    }
    if (data === "\x1b" || data === "\x1b\x1b") {
      this.onCancel?.();
      return;
    }
    if (data === "\r" || data === "\n") {
      this.activate();
      return;
    }
    // Digit jump: 1-9 → first 9 options.
    const m = /^[1-9]$/.exec(data);
    if (m) {
      const idx = Number.parseInt(m[0], 10) - 1;
      if (idx < this.options.length) this.selected = idx;
    }
  }

  private handleOtherInput(data: string): void {
    if (data === "\x1b" || data === "\x1b\x1b") {
      // Esc from the field un-focuses it; the picker stays open for a fresh
      // attempt. Empty submit also reaches here (the caller routes blank
      // submits to onCancel, so this only fires on real Esc).
      this.editingOther = false;
      this.onCancelEdit?.();
      return;
    }
    if (data === "\r" || data === "\n") {
      this.confirmOther();
      return;
    }
    if (data === "\x7f" || data === "\b") {
      this.otherText = this.otherText.slice(0, -1);
      return;
    }
    // Accept printable text. Some sequences (e.g. paste) come as multi-char
    // data — accept them as-is rather than dropping the rest.
    if (data.length >= 1 && data.charCodeAt(0) >= 32) {
      this.otherText += data;
    }
  }

  private moveSelection(delta: number): void {
    const n = this.options.length;
    if (n === 0) return;
    this.selected = (this.selected + delta + n) % n;
  }

  /**
   * Enter on the picker. On a non-Other row this commits immediately. On the
   * Other row it opens the inline editor — the user has to opt in to the
   * free-text flow rather than being submitted by an empty string.
   */
  private activate(): void {
    const opt = this.options[this.selected];
    if (!opt) return;
    if (opt.isOther) {
      this.editingOther = true;
      this.onOpenedOther?.();
      return;
    }
    this.onSelect?.(opt.label);
  }

  /**
   * Enter in the "Other" field. Empty text is treated like Esc — the modal
   * never sends a blank answer; the caller dismisses the question.
   */
  private confirmOther(): void {
    const text = this.otherText.trim();
    if (!text) {
      this.editingOther = false;
      this.otherText = "";
      this.onCancel?.();
      return;
    }
    this.onSelect?.(text);
  }

  // --- hooks set by the caller (apps/tui/src/index.ts) ---

  /** Fires with the chosen label (or typed "Other" text) on a real pick. */
  onSelect?: (label: string) => void;
  /** Fires on Esc from the picker, or on a blank "Other" submit. */
  onCancel?: () => void;
  /** Fires when the "Other" row is opened — purely informational. */
  onOpenedOther?: () => void;
  /** Fires when Esc closes the "Other" field without committing. */
  onCancelEdit?: () => void;
  /** Fires on ←/→ with -1/+1; only when the request has several questions. */
  onNavigate?: (delta: -1 | 1) => void;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Build the option rows from the question spec. Filters out malformed
 * options (null, missing label) the same way the inline picker did, then
 * appends the synthetic "Other" row. The synthetic row is always present so
 * the user gets a free-text escape hatch on every question, matching tui-rs.
 */
function buildOptions(
  optionsInput: QuestionSpec["options"],
): OptionRow[] {
  const rows: OptionRow[] = (optionsInput ?? [])
    .filter((o): o is NonNullable<typeof o> => o != null)
    .map((o) => {
      const label =
        typeof o.label === "string" && o.label.length > 0
          ? o.label
          : (o.description ?? "");
      return {
        label,
        description: o.description ?? "",
        isOther: false,
      };
    })
    .filter((r) => r.label.length > 0);
  rows.push({
    label: OTHER_LABEL,
    description: OTHER_DESCRIPTION,
    isOther: true,
  });
  return rows;
}

/**
 * Build one interior row: left border + fitted content + padding + right
 * border. The full row is card-width so the overlay composite renders cleanly
 * over the transcript.
 */
function row(
  content: string,
  inner: number,
  left: string,
  right: string,
  _dim: (s: string) => string,
): string {
  const fitted = truncateToWidth(content, inner);
  const pad = Math.max(0, inner - visibleWidth(fitted));
  // No background fill — the card is transparent. The padding is still emitted
  // as plain spaces so every row is exactly card-width; a short row would break
  // the overlay composite.
  return `${left}${fitted}${" ".repeat(pad)}${right}`;
}

/** Blank interior row used for breathing space above/below content. */
function blankRow(inner: number, left: string, right: string): string {
  return `${left}${" ".repeat(inner)}${right}`;
}

/**
 * Window start for a vertical pager. Keeps `selected` in view by sliding the
 * window backwards when the cursor climbs past the top.
 */
function clampWindowStart(selected: number, total: number, visible: number): number {
  if (total <= visible) return 0;
  const end = Math.min(selected + Math.ceil(visible / 2), total);
  const start = Math.max(0, end - visible);
  return start;
}
