//! Top status bar — three independently-sized segments (left mode badge +
//! cycling hint, center identity, right context meter) joined with auto-sized
//! gaps on a fixed dark-grey background.
//!
//! Design:
//!   - Each segment is built as a `Vec<Span<'static>>` so callers can keep
//!     the rendered style (colors, weights) next to the data they describe,
//!     and so the render path never has to clone.
//!   - The top-level `render` takes the three segments, measures their plain
//!     (un-styled) widths, and drops the rightmost first when the terminal
//!     is too narrow — center identity is the last to go.
//!   - Colors live as module-level `Color` constants so the palette is a
//!     single source of truth and can be tweaked in one place.

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

use super::oscilloscope;
use crate::app::{ContextUsage, Mode, Status};

/// Width, in braille cells, of each oscilloscope that flanks the model name.
const WAVE_CELLS: usize = 8;

// ─── palette ────────────────────────────────────────────────────────────────

/// Background of the entire status row — matches the original `DarkGray` bg
/// the bar used before the refactor.
const STATUS_BG: Color = Color::DarkGray;
/// Foreground of plain text on the status row.
const STATUS_FG: Color = Color::White;
/// Dim secondary text (status word, hint, percentage). One shade brighter
/// than the bg so it reads as "secondary" but is still legible on DarkGray.
const STATUS_DIM: Color = Color::Gray;
/// Background of the mode badge — a cyan rectangle so the mode reads as a
/// distinct container on the status row.
const MODE_BG: Color = Color::Cyan;
/// Foreground of the mode badge — dark text for legible contrast on cyan.
const MODE_FG: Color = Color::Black;
/// Color of the oscilloscope waveforms flanking the model name.
const WAVE_FG: Color = Color::Rgb(255, 105, 180);

/// Public re-export so callers (e.g., the `Paragraph` wrapper) can apply the
/// same bg color to the widget itself without re-declaring it.
pub fn status_bg() -> Color {
    STATUS_BG
}

/// Filled-bar color thresholds (mirrors the TS TUI's green/yellow/red ramp).
const BAR_OK: Color = Color::Green;
const BAR_WARN: Color = Color::Yellow;
const BAR_DANGER: Color = Color::Red;

/// Width of the context bar in cells. Wide enough to be readable at a glance
/// but narrow enough that the rest of the row stays informative.
const CONTEXT_BAR_WIDTH: usize = 10;

/// Gap between adjacent segments, in cells. Two looks right with the dark
/// background; one feels cramped, three splits the row visually.
const SEGMENT_GAP: usize = 2;

// ─── entry point ────────────────────────────────────────────────────────────

/// Build the rendered status row as a single `Line`. The whole line carries
/// the dark-grey background; the per-segment spans carry their own fg color.
///
/// `width` is the total number of cells available (typically `frame.area().width`).
pub fn render(
    width: u16,
    mode: Mode,
    usage: ContextUsage,
    center: &[Span<'static>],
) -> Line<'static> {
    // Layout: [ mode + hint ]   [ identity ]   [ context meter ]
    let left = mode_segment(mode);
    let right = context_segment(usage);

    let plain_left = plain_width(&left);
    let plain_right = plain_width(&right);
    let plain_center = plain_width(center);

    let needed = plain_left + SEGMENT_GAP + plain_center + SEGMENT_GAP + plain_right;

    let (left_line, center_line, right_line): (Vec<Span<'static>>, Vec<Span<'static>>, Vec<Span<'static>>) =
        if needed <= width as usize {
            // Everything fits — render all three with full gaps.
            (left, center.to_vec(), right)
        } else {
            // Progressive shrink: drop the context meter (informational,
            // rightmost) first, then the mode hint (leftmost). The center
            // identity is dropped only as a last resort.
            let without_right = plain_left + SEGMENT_GAP + plain_center + SEGMENT_GAP;

            if without_right <= width as usize {
                (left, center.to_vec(), Vec::new())
            } else {
                (Vec::new(), center.to_vec(), Vec::new())
            }
        };

    build_line(width, &left_line, &center_line, &right_line)
}

// ─── segment builders ───────────────────────────────────────────────────────

/// `context 12.3k/200k [████░░░░░░] 6%` — empty when limit is unknown.
fn context_segment(usage: ContextUsage) -> Vec<Span<'static>> {
    let Some(ratio) = usage.ratio() else {
        return Vec::new();
    };
    let clamped = ratio.clamp(0.0, 1.0);
    let filled = (clamped * CONTEXT_BAR_WIDTH as f64).round() as usize;
    let empty = CONTEXT_BAR_WIDTH.saturating_sub(filled);

    let fill_color = if clamped < 0.5 {
        BAR_OK
    } else if clamped < 0.8 {
        BAR_WARN
    } else {
        BAR_DANGER
    };

    let pct = format!("{}%", (clamped * 100.0).round() as u32);
    let usage_str = format!(
        "{}/{}",
        format_tokens(usage.tokens),
        format_tokens(usage.limit)
    );

    vec![
        Span::styled("context ".to_string(), dim()),
        Span::styled(usage_str, dim()),
        Span::raw(" "),
        Span::raw("["),
        Span::styled("█".repeat(filled), Style::default().fg(fill_color)),
        Span::styled("░".repeat(empty), Style::default().fg(STATUS_DIM)),
        Span::raw("]"),
        Span::raw(" "),
        Span::styled(pct, dim()),
    ]
}

/// `[ MODE ]` — bold white inside a padded rectangle with a darker background
/// (`MODE_BG`) so the mode reads as a distinct container on the status row.
/// No per-mode coloring, no inline hint text.
fn mode_segment(mode: Mode) -> Vec<Span<'static>> {
    let icon = mode.icon();
    let text = if icon.is_empty() {
        format!(" {} ", mode.label())
    } else {
        format!(" {} {} ", icon, mode.label())
    };
    vec![Span::styled(
        text,
        Style::default()
            .bg(MODE_BG)
            .fg(MODE_FG)
            .add_modifier(Modifier::BOLD),
    )]
}

// ─── layout ─────────────────────────────────────────────────────────────────

fn build_line(
    width: u16,
    left: &[Span<'static>],
    center: &[Span<'static>],
    right: &[Span<'static>],
) -> Line<'static> {
    let plain_left = plain_width(left);
    let plain_right = plain_width(right);
    let plain_center = plain_width(center);
    let width = width as usize;

    // Center the identity on the *whole row* (not on the gap between the
    // wings), then flush the right segment to the far edge. Centering within
    // the inter-wing space would offset the name by half the wings' width
    // difference; anchoring to the row keeps `provider/model` visually centered
    // regardless of how wide the mode badge or context meter are.
    let ideal_start = width.saturating_sub(plain_center) / 2;
    let min_start = plain_left + SEGMENT_GAP;
    let max_start = width.saturating_sub(plain_right + SEGMENT_GAP + plain_center);
    let center_start = ideal_start.clamp(min_start, max_start.max(min_start));

    let left_gap = center_start.saturating_sub(plain_left);
    let right_start = width.saturating_sub(plain_right);
    let right_gap = right_start.saturating_sub(center_start + plain_center);
    // Right segment is flush to the row edge, so there is nothing after it.
    let tail = String::new();

    // Every span in the row — segments, gaps, and tail — must carry the bg,
    // otherwise the cells between segments would inherit the terminal's
    // default background and the row would look striped.
    let bg_only = Style::default().bg(STATUS_BG);
    let fg_style = Style::default().bg(STATUS_BG).fg(STATUS_FG);
    let dim_style = Style::default().bg(STATUS_BG).fg(STATUS_DIM);

    // Recoloring patches both bg and fg. The center segment carries its own
    // fg via `fg_style` (STATUS_FG) as a base, so its override is empty —
    // that lets spans with an explicit color (the pink oscilloscope waves)
    // survive while the plain name still falls back to the row foreground.
    let center_fg = Style::default();
    let dim_fg = Style::default().fg(STATUS_DIM);

    let mut spans: Vec<Span<'static>> = Vec::new();
    // The mode badge carries its own bg (cyan) and fg (dark) — recolor with
    // the badge's own fg so it isn't repainted to the row's foreground.
    spans.extend(recolor(left, bg_only, Style::default().fg(MODE_FG)));
    if left_gap > 0 {
        spans.push(Span::styled(" ".repeat(left_gap), bg_only));
    }
    spans.extend(recolor(center, fg_style, center_fg));
    if right_gap > 0 {
        spans.push(Span::styled(" ".repeat(right_gap), bg_only));
    }
    spans.extend(recolor(right, bg_only, dim_fg));
    if !tail.is_empty() {
        spans.push(Span::styled(tail, dim_style));
    }

    Line::from(spans)
}

/// Patch `base` then `fg` into each span's style. The bg side of `base` is
/// applied unless the span already declares a bg; `fg` overlays so spans
/// that explicitly set an fg keep it.
fn recolor(spans: &[Span<'static>], base: Style, fg: Style) -> Vec<Span<'static>> {
    spans
        .iter()
        .map(|s| {
            let merged = base.patch(s.style);
            let with_fg = merged.patch(fg);
            Span::styled(s.content.clone(), with_fg)
        })
        .collect()
}

fn plain_width(spans: &[Span<'_>]) -> usize {
    spans.iter().map(|s| s.content.chars().count()).sum()
}

fn dim() -> Style {
    Style::default().bg(STATUS_BG).fg(STATUS_DIM)
}

// ─── formatters ─────────────────────────────────────────────────────────────

/// `1_234` → `1.2k`, `12_345_678` → `12.3M`. Short enough for a status bar;
/// the core's full breakdown is one click away in `/usage`.
fn format_tokens(n: u64) -> String {
    const K: u64 = 1_000;
    const M: u64 = 1_000_000;
    if n >= M {
        format!("{:.1}M", n as f64 / M as f64)
    } else if n >= K {
        format!("{:.1}k", n as f64 / K as f64)
    } else {
        n.to_string()
    }
}

// ─── helpers exported for ui/mod.rs to build the center segment ─────────────

/// The center identity row. While the agent is streaming an oscilloscope flanks
/// the model name on both sides (`~wave~ provider/model ~wave~`); at rest it is
/// just `provider/model`. `phase`/`energy` drive the waveform. `build_line`
/// recolors center spans to the row foreground, so the waveform pulses via
/// BOLD/DIM modifiers (which survive that recolor) rather than carrying colour.
pub fn center_segment(
    provider: &str,
    model: &str,
    status: Status,
    phase: f32,
    energy: f32,
) -> Vec<Span<'static>> {
    let provider = if provider.is_empty() { "-" } else { provider };
    let model = if model.is_empty() { "-" } else { model };

    let name = Span::styled(format!("{provider}/{model}"), Style::default());
    if status == Status::Idle {
        return vec![name];
    }

    let wave = oscilloscope::waveform(WAVE_CELLS, phase, energy);
    let modifier = if energy > 0.5 {
        Modifier::BOLD
    } else if energy < 0.15 {
        Modifier::DIM
    } else {
        Modifier::empty()
    };
    let wave_style = Style::default().fg(WAVE_FG).add_modifier(modifier);
    // Mirror the left side so the two waveforms are symmetric around the name.
    let left: String = wave.chars().rev().collect();

    vec![
        Span::styled(left, wave_style),
        Span::styled("  ".to_string(), dim()),
        name,
        Span::styled("  ".to_string(), dim()),
        Span::styled(wave, wave_style),
    ]
}
