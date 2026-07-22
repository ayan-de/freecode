//! The modal card: question/permission asks (core is stopped while these are
//! on screen, so they read as a hard interrupt) and the local `/model` provider
//! and model pickers. Searchable pickers add a type-to-search line above a
//! windowed, scrolling list so long provider/model lists stay navigable.

use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::{Prompt, PromptKind};

const PINK: Color = Color::Rgb(255, 105, 180);
/// Card background — same `DarkGray` as the top status bar (`ui::status`).
const CARD_BG: Color = Color::DarkGray;
/// Background of the active row and the "Other" text field — one shade lighter
/// than the card so the focused element reads as a raised input box.
const INPUT_BG: Color = Color::Rgb(55, 55, 62);
/// Widest the card gets, so it stays readable on a full-screen terminal.
const MAX_WIDTH: u16 = 78;
/// Rows of a searchable list shown at once before it scrolls (matches the TS
/// TUI's `SearchableSelectList`). The rest are reached with ↑/↓.
const MAX_VISIBLE: usize = 10;

fn dim() -> Style {
    Style::default().fg(Color::DarkGray).bg(CARD_BG)
}

pub fn draw(frame: &mut Frame, prompt: &Prompt, area: Rect) {
    let lines = body(prompt);
    let width = MAX_WIDTH.min(area.width.saturating_sub(4)).max(20);
    // +2 border, +2 vertical padding; clamp so a short terminal still renders.
    let height = (lines.len() as u16 + 4).min(area.height);
    let card = centered(area, width, height);

    let accent = match prompt.kind {
        PromptKind::Question => PINK,
        PromptKind::Permission => Color::Cyan,
        // Both `/model` steps share the magenta of the model badge.
        PromptKind::Provider | PromptKind::Model => Color::Magenta,
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(accent))
        .title(Span::styled(
            format!(" {} ", prompt.title),
            Style::default()
                .bg(accent)
                .fg(Color::Black)
                .add_modifier(Modifier::BOLD),
        ))
        .title_alignment(Alignment::Left)
        .style(Style::default().bg(CARD_BG));

    // Clear punches a hole in the transcript so the card is opaque.
    frame.render_widget(Clear, card);
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .wrap(Wrap { trim: false }),
        card,
    );
}

fn body(prompt: &Prompt) -> Vec<Line<'static>> {
    if prompt.is_searchable() {
        return searchable_body(prompt);
    }

    let mut lines = Vec::new();

    if !prompt.subtitle.is_empty() {
        lines.push(Line::from(Span::styled(
            prompt.subtitle.clone(),
            Style::default().fg(Color::White).bg(CARD_BG),
        )));
    }
    lines.push(Line::from(""));

    for (i, option) in prompt.options.iter().enumerate() {
        let active = i == prompt.selected;
        let marker = if prompt.multiple {
            if prompt.checked.get(i).copied().unwrap_or(false) {
                "◉ "
            } else {
                "◯ "
            }
        } else if active {
            "❯ "
        } else {
            "  "
        };

        let label_style = if active {
            Style::default()
                .fg(Color::White)
                .bg(INPUT_BG)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::Gray).bg(CARD_BG)
        };

        lines.push(Line::from(vec![
            Span::styled(marker, Style::default().fg(PINK).bg(CARD_BG)),
            Span::styled(format!("{}. ", i + 1), dim()),
            Span::styled(option.label.clone(), label_style),
        ]));
        if !option.description.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("     {}", option.description),
                dim(),
            )));
        }
    }

    // Free-text field for the "Other" row: rendered right under the options
    // while focused, with a placeholder until the user types and a block cursor.
    if prompt.editing_other {
        let (text, style) = if prompt.other_text.is_empty() {
            ("type your answer…".to_string(), Style::default().fg(Color::DarkGray).bg(INPUT_BG))
        } else {
            (prompt.other_text.clone(), Style::default().fg(Color::White).bg(INPUT_BG))
        };
        lines.push(Line::from(vec![
            Span::styled("     ", Style::default().bg(CARD_BG)),
            Span::styled("› ", Style::default().fg(PINK).bg(INPUT_BG)),
            Span::styled(text, style),
            Span::styled("▏", Style::default().fg(PINK).bg(INPUT_BG)),
        ]));
    }

    lines.push(Line::from(""));
    let hint = if prompt.editing_other {
        "type your answer · enter submit · esc back"
    } else if prompt.multiple {
        "↑↓ move · space toggle · 1-9 jump · enter submit · esc cancel"
    } else {
        "↑↓ move · 1-9 jump · enter select · esc cancel"
    };
    lines.push(Line::from(Span::styled(hint, dim())));
    lines
}

/// The `/model` provider and model pickers: a type-to-search line above a
/// scrolling window of the matching rows, with "N more" markers for the parts
/// off-screen above/below.
fn searchable_body(prompt: &Prompt) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    // Search line: the live query with a block cursor, or a hint when empty.
    if prompt.search.is_empty() {
        lines.push(Line::from(Span::styled(
            "Type to search · ↑↓ select · enter confirm · esc cancel",
            dim(),
        )));
    } else {
        lines.push(Line::from(vec![
            Span::styled("Search: ", dim()),
            Span::styled(prompt.search.clone(), Style::default().fg(Color::White).bg(CARD_BG)),
            Span::styled("▏", Style::default().fg(Color::Magenta).bg(CARD_BG)),
        ]));
    }
    lines.push(Line::from(""));

    let filtered = prompt.filtered_indices();
    if filtered.is_empty() {
        lines.push(Line::from(Span::styled("  no matches", dim())));
        return lines;
    }

    let (start, end) = window(prompt.selected, filtered.len(), MAX_VISIBLE);
    if start > 0 {
        lines.push(Line::from(Span::styled(format!("  ↑ {start} more"), dim())));
    }
    for (offset, &opt_idx) in filtered[start..end].iter().enumerate() {
        let option = &prompt.options[opt_idx];
        let active = start + offset == prompt.selected;
        let row_bg = if active { INPUT_BG } else { CARD_BG };
        let label_style = if active {
            Style::default().fg(Color::White).bg(row_bg).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::Gray).bg(row_bg)
        };
        let mut spans = vec![
            Span::styled(if active { "❯ " } else { "  " }, Style::default().fg(Color::Magenta).bg(row_bg)),
            Span::styled(option.label.clone(), label_style),
        ];
        if !option.description.is_empty() {
            spans.push(Span::styled(
                format!("  {}", truncate(&option.description, 44)),
                Style::default().fg(Color::DarkGray).bg(row_bg),
            ));
        }
        lines.push(Line::from(spans));
    }
    if end < filtered.len() {
        lines.push(Line::from(Span::styled(
            format!("  ↓ {} more", filtered.len() - end),
            dim(),
        )));
    }
    lines
}

/// The visible slice `[start, end)` of a `total`-length list that keeps
/// `selected` on screen within `max` rows, biasing toward centering the cursor.
fn window(selected: usize, total: usize, max: usize) -> (usize, usize) {
    if total <= max {
        return (0, total);
    }
    let start = selected.saturating_sub(max / 2).min(total - max);
    (start, start + max)
}

/// Trim `s` to at most `max` chars, adding an ellipsis when it was cut.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let kept: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{kept}…")
}

/// A card of `width`×`height` centered in `area`, clamped to it.
fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;
    Rect { x, y, width, height }
}
