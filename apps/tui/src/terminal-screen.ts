// =============================================================================
// terminal-screen — alternate screen buffer control.
//
// Puts the TUI in its own screen (like vim/less/Claude Code): the user's
// prior shell scrollback is hidden while freecode runs and reappears
// untouched on exit, so the TUI always starts painting from row 1 instead
// of appending below whatever was already in the terminal.
// =============================================================================

// The alt buffer has no scrollback, so the terminal's native mouse-wheel
// scroll has nothing to scroll — \x1b[?1000h reports mouse button/wheel
// events instead, and \x1b[?1006h uses SGR encoding so events parse
// unambiguously regardless of terminal size. index.ts decodes the wheel
// events and drives VirtualMessageList's own scroll.
const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1000l";

// \x1b[?1049h saves the cursor and switches to the alt buffer; \x1b[2J\x1b[H
// clears it and homes the cursor for terminals that don't guarantee a blank
// alt screen.
export const ENTER_ALT_SCREEN = `\x1b[?1049h\x1b[2J\x1b[H${ENABLE_MOUSE}`;

// \x1b[?1049l switches back to the main buffer, restoring its content and
// the cursor position saved on entry.
const EXIT_ALT_SCREEN = `${DISABLE_MOUSE}\x1b[?1049l`;

let restored = false;

// Idempotent — safe to call from multiple exit paths (explicit shutdown,
// the process "exit" safety net) without double-writing the sequence.
export function restoreScreen(): void {
  if (restored) return;
  restored = true;
  process.stdout.write(EXIT_ALT_SCREEN);
}
