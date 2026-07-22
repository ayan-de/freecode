//! The blocking modal: question and permission asks. Core is stopped while
//! this is on screen, so it reads as a hard interrupt — a centered card over a
//! dimmed transcript rather than another line in the scroll.

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

/// A card of `width`×`height` centered in `area`, clamped to it.
fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;
    Rect { x, y, width, height }
}
