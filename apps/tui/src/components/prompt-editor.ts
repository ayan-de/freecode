import { Editor, type TUI } from "@earendil-works/pi-tui";
import type { EditorTheme } from "@earendil-works/pi-tui";

/**
 * PromptEditor — pi-tui Editor with a `❯` prompt prefix on the input line,
 * like Claude Code. Padding reserves two columns on every content line; the
 * prefix is painted into the reserved space of the first line, so cursor
 * column math and line widths are unchanged. The prefix uses the editor's
 * border color, so it follows the agent-mode color automatically.
 */
export class PromptEditor extends Editor {
  constructor(tui: TUI, theme: EditorTheme) {
    super(tui, theme, { paddingX: 2 });
  }

  render(width: number): string[] {
    const lines = super.render(width);
    // lines[0] is the top border; the first content line follows it.
    if (lines.length > 1 && lines[1].startsWith("  ")) {
      lines[1] = this.borderColor("❯") + lines[1].slice(1);
    }
    return lines;
  }
}
