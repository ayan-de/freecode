//! Tool-call rendering: one collapsed line per call, expandable to args and
//! output. Running calls animate a spinner and show a live output tail so a
//! long bash/grep feels alive instead of frozen.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

use crate::app::ToolCall;

/// The tool-name chip's background, matching the pink used for the composer
/// prompt and the logo's "Free".
const CHIP_BG: Color = Color::Rgb(255, 105, 180);
/// Backgrounds for diff rows, mirroring `apps/tui/src/components/diff-view.ts`.
const ADD_BG: Color = Color::Rgb(20, 60, 26);
const DEL_BG: Color = Color::Rgb(77, 20, 25);

/// Braille spinner frames, advanced off the shared animation clock.
const SPINNER: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
/// A line-numbered diff row from core's `generateDiffString`, as consumed by
/// `apps/tui/src/components/diff-view.ts`: "+ 12 content" / "- 12 content" /
/// "  12 content".
fn diff_row(line: &str) -> Option<(char, &str)> {
    let mut chars = line.chars();
    let marker = chars.next()?;
    if !matches!(marker, '+' | '-' | ' ') {
        return None;
    }
    let rest = chars.as_str();
    let digits_end = rest.find(|c: char| !c.is_ascii_digit() && c != ' ')?;
    if !rest[..digits_end].trim().chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((marker, line))
}

/// True when a tool result is a core-generated diff. A diff can open with a
/// context line, so scan for an actual add/remove row rather than only the first.
fn looks_like_diff(text: &str) -> bool {
    text.lines()
        .any(|l| matches!(diff_row(l), Some((m, _)) if m == '+' || m == '-'))
}

/// Live tail rows shown under a running call.
const TAIL_ROWS: usize = 3;
/// Output rows shown when a finished call is expanded.
const EXPANDED_ROWS: usize = 12;

fn dim() -> Style {
    Style::default().fg(Color::DarkGray)
}

/// Icon shown in a tool's chip, keyed by tool name. Everything maps to the same
/// glyph for now; give a tool its own icon by adding an arm above the catch-all
/// (e.g. `"bash" => ""`). MCP tools arrive as `server_tool` names and fall
/// through to the default until listed.
fn tool_icon(name: &str) -> &'static str {
    match name {
        "read" => "",
        "write" => "",
        "glob" => "󱆃",
        "grep" => "󰛄",
        "edit" => "",
        "bash" => "",
        "skill" => "",
        "agent" => "󰵰",
        "question" => "",
        "webfetch" => "",
        "websearch" => "󰜏",
        "todowrite" => "",
        "lsp" => "",
        // MCP tools (server-prefixed names) and anything unlisted:
        _ => "󰟶",
    }
}

pub fn render(call: &ToolCall, phase: f32, expanded: bool) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(header(call, phase, expanded))];

    if call.success.is_none() {
        // Running: last few output lines, dimmed, discarded once complete.
        for line in call.output.iter().rev().take(TAIL_ROWS).rev() {
            lines.push(body_line(line));
        }
    } else if expanded {
        let diff = looks_like_diff(&call.result);
        for line in call.result.lines().take(EXPANDED_ROWS) {
            lines.push(if diff { diff_line(line) } else { body_line(line) });
        }
        let extra = call.result.lines().count().saturating_sub(EXPANDED_ROWS);
        if extra > 0 {
            lines.push(body_line(&format!("… +{extra} more lines")));
        }
    }

    lines
}

fn header(call: &ToolCall, phase: f32, expanded: bool) -> Vec<Span<'static>> {
    let (marker, color) = match call.success {
        None => (
            SPINNER[((phase * 12.0) as usize) % SPINNER.len()].to_string(),
            Color::Cyan,
        ),
        Some(true) => ("✓".to_string(), Color::Green),
        Some(false) => ("✗".to_string(), Color::Red),
    };

    let mut spans = vec![
        Span::styled(format!("{marker} "), Style::default().fg(color)),
        Span::styled(
            format!(" {} {} ", tool_icon(&call.name), call.name),
            Style::default()
                .bg(CHIP_BG)
                .fg(Color::Black)
                .add_modifier(Modifier::BOLD),
        ),
    ];
    if !call.summary.is_empty() {
        spans.push(Span::styled(format!(" {}", call.summary), dim()));
    }
    // For edit/write the counts say more than the raw result ever would.
    let (added, removed) = diff_stats(&call.result);
    if added + removed > 0 {
        spans.push(Span::styled(
            format!(" +{added}"),
            Style::default().fg(Color::Green),
        ));
        spans.push(Span::styled(
            format!(" -{removed}"),
            Style::default().fg(Color::Red),
        ));
    }
    if let Some(ms) = call.duration_ms {
        spans.push(Span::styled(format!(" · {:.1}s", ms as f64 / 1000.0), dim()));
    }
    // Only advertise the toggle for calls that actually have something hidden.
    if call.success.is_some() && !expanded && !call.result.trim().is_empty() {
        spans.push(Span::styled(" ⌄", dim()));
    }
    spans
}

/// Added/removed row counts for a diff result; `(0, 0)` for anything else.
fn diff_stats(text: &str) -> (usize, usize) {
    if !looks_like_diff(text) {
        return (0, 0);
    }
    text.lines().fold((0, 0), |(a, r), l| match diff_row(l) {
        Some(('+', _)) => (a + 1, r),
        Some(('-', _)) => (a, r + 1),
        _ => (a, r),
    })
}

/// A diff row, colored the way the TS TUI colors it: additions on dark green,
/// removals on dark red, context dimmed.
fn diff_line(line: &str) -> Line<'static> {
    let style = match diff_row(line) {
        Some(('+', _)) => Style::default().bg(ADD_BG).fg(Color::LightGreen),
        Some(('-', _)) => Style::default().bg(DEL_BG).fg(Color::LightRed),
        _ => dim(),
    };
    Line::from(vec![
        Span::styled("  │ ", dim()),
        Span::styled(truncate(line, 160), style),
    ])
}

fn body_line(text: &str) -> Line<'static> {
    Line::from(vec![
        Span::styled("  │ ", dim()),
        Span::styled(truncate(text, 160), dim()),
    ])
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFF: &str = "  10 unchanged\n- 11 old line\n+ 11 new line\n+ 12 added";

    #[test]
    fn recognizes_and_counts_core_diffs() {
        assert!(looks_like_diff(DIFF));
        assert_eq!(diff_stats(DIFF), (2, 1));
    }

    #[test]
    fn plain_output_is_not_a_diff() {
        assert!(!looks_like_diff("total 0\ndrwxr-xr-x src"));
        assert_eq!(diff_stats("read 240 lines"), (0, 0));
    }
}
