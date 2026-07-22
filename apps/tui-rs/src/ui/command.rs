//! Slash-command completion menu: a small popup anchored above the composer
//! listing the commands whose name matches what the user has typed after `/`.
//! `ui::draw` renders it only while the composer holds a command prefix;
//! navigation and the selected index live on `App`.

use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph};
use ratatui::Frame;

use crate::commands::Command;

const CARD_BG: Color = Color::DarkGray;
const ACCENT: Color = Color::Cyan;
/// Highlight for the selected row — one shade lighter than the card, matching
/// the question modal's active row.
const SELECTED_BG: Color = Color::Rgb(55, 55, 62);
/// Cap so a long list can never swallow the whole transcript.
const MAX_ROWS: u16 = 8;

/// Draw the menu anchored to the bottom of `area` (the transcript region, just
/// above the composer). `selected` is pre-clamped to the match count by the
/// caller.
pub fn draw(frame: &mut Frame, matches: &[&dyn Command], selected: usize, area: Rect) {
    // Longest invocation sets the column width so descriptions line up.
    let name_w = matches.iter().map(|c| c.name().len()).max().unwrap_or(0);

    let mut lines: Vec<Line> = Vec::new();
    for (i, command) in matches.iter().enumerate() {
        let active = i == selected;
        let row_bg = if active { SELECTED_BG } else { CARD_BG };
        let hint = command
            .arg_hint()
            .map(|h| format!(" {h}"))
            .unwrap_or_default();
        lines.push(Line::from(vec![
            Span::styled(
                if active { "❯ " } else { "  " },
                Style::default().fg(ACCENT).bg(row_bg),
            ),
            Span::styled(
                format!("/{:name_w$}", command.name(), name_w = name_w),
                Style::default()
                    .fg(Color::White)
                    .bg(row_bg)
                    .add_modifier(if active { Modifier::BOLD } else { Modifier::empty() }),
            ),
            Span::styled(
                format!("{hint}  {}", command.description()),
                Style::default().fg(Color::Gray).bg(row_bg),
            ),
        ]));
    }

    // +2 for the border rows.
    let height = (matches.len() as u16 + 2).min(MAX_ROWS + 2).min(area.height);
    let width = area.width.clamp(20, 64);
    let card = Rect {
        x: area.x,
        y: area.y + area.height.saturating_sub(height),
        width,
        height,
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(ACCENT))
        .title(Span::styled(
            " commands · tab to complete ",
            Style::default().fg(ACCENT),
        ))
        .style(Style::default().bg(CARD_BG));

    // Clear punches an opaque hole so the transcript doesn't bleed through.
    frame.render_widget(Clear, card);
    frame.render_widget(Paragraph::new(lines).block(block), card);
}
