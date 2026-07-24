//! The `/session` resume modal: a scrollable session list on the left and a
//! markdown transcript preview of the highlighted session on the right. The
//! preview reuses the shared markdown renderer (`ui::markdown`).

use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, BorderType, Borders, Clear, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
    Wrap,
};
use ratatui::Frame;

use super::markdown;
use crate::app::SessionPicker;
use crate::ipc::protocol::SerializedMessage;

const ACCENT: Color = Color::Cyan;
const PINK: Color = Color::Rgb(255, 105, 180);
const CARD_BG: Color = Color::DarkGray;
const SEL_BG: Color = Color::Rgb(55, 55, 62);

pub fn draw(frame: &mut Frame, picker: &SessionPicker, area: Rect) {
    // A near-full-screen card, leaving a small margin.
    let card = margin(area, 4, 2);
    frame.render_widget(Clear, card);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(ACCENT))
        .title(Span::styled(
            " Resume a session ",
            Style::default()
                .bg(ACCENT)
                .fg(Color::Black)
                .add_modifier(Modifier::BOLD),
        ))
        .title_bottom(Line::from(Span::styled(
            " ↑/↓ move · Tab focus preview · Enter resume · Esc cancel ",
            Style::default().fg(Color::Gray).bg(CARD_BG),
        )).alignment(Alignment::Right))
        .style(Style::default().bg(CARD_BG));
    let inner = block.inner(card);
    frame.render_widget(block, card);

    // Split: list (left ~38%) | preview (right).
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(38), Constraint::Percentage(62)])
        .split(inner);

    draw_list(frame, picker, cols[0]);
    draw_preview(frame, picker, cols[1]);
}

fn draw_preview(frame: &mut Frame, picker: &SessionPicker, area: Rect) {
    // A bordered pane that brightens when the preview has focus.
    let border = if picker.preview_focus { ACCENT } else { Color::DarkGray };
    let block = Block::default()
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(border))
        .style(Style::default().bg(CARD_BG));
    let inner = margin(block.inner(area), 1, 0);
    frame.render_widget(block, area);

    let lines: Vec<Line> = match picker.selected_id().and_then(|id| picker.previews.get(id)) {
        Some(msgs) => markdown::render(&preview_markdown(msgs)),
        None => vec![Line::from(Span::styled(
            "loading preview…",
            Style::default().fg(Color::DarkGray),
        ))],
    };
    let para = Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .style(Style::default().bg(CARD_BG));

    // Total wrapped height vs viewport → clamp scroll and size the scrollbar.
    let total = para.line_count(inner.width) as u16;
    let viewport = inner.height;
    let max_scroll = total.saturating_sub(viewport);
    let scroll = picker.preview_scroll.min(max_scroll);
    frame.render_widget(para.scroll((scroll, 0)), inner);

    if total > viewport {
        let mut state = ScrollbarState::new(max_scroll as usize).position(scroll as usize);
        frame.render_stateful_widget(
            Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(None)
                .end_symbol(None)
                .thumb_style(Style::default().fg(if picker.preview_focus { ACCENT } else { Color::Gray }))
                .track_style(Style::default().fg(Color::DarkGray)),
            area,
            &mut state,
        );
    }
}

fn draw_list(frame: &mut Frame, picker: &SessionPicker, area: Rect) {
    // Each session occupies ROWS rows (title, project, closed, created), so the
    // pane fits as many as its height allows and the list fills full height.
    const ROWS: usize = 5;
    let visible = (area.height as usize / ROWS).max(1);
    let start = window_start(picker.cursor, picker.sessions.len(), visible);
    let width = area.width.saturating_sub(2) as usize;
    let mut lines: Vec<Line> = Vec::new();
    for (i, s) in picker
        .sessions
        .iter()
        .enumerate()
        .skip(start)
        .take(visible)
    {
        let selected = i == picker.cursor;
        let bg = if selected { SEL_BG } else { CARD_BG };
        let title = if s.title.trim().is_empty() { "(untitled)" } else { &s.title };
        // Session name in pink, folder in cyan; both keep their color whether or
        // not the row is selected (only the background changes).
        let title_style = Style::default().bg(bg).fg(PINK).add_modifier(Modifier::BOLD);
        let folder_style = Style::default().bg(bg).fg(Color::Cyan);
        // Note: CARD_BG is DarkGray, so meta text must be lighter than that or
        // it renders invisible against the card. On the selected row the meta
        // shares the selection background so the whole item reads as one block.
        let dim = Style::default().fg(if selected { Color::White } else { Color::Gray }).bg(bg);
        let full = area.width as usize;
        let prefix = if selected { "› " } else { "  " };
        lines.push(Line::from(Span::styled(
            pad(&format!("{prefix}{} · {} turns", truncate(title, width.saturating_sub(10)), s.turn_count), full),
            title_style,
        )));
        lines.push(Line::from(Span::styled(
            pad(&format!("  \u{f024b} {}", truncate(&s.project_path, width.saturating_sub(3))), full),
            folder_style,
        )));
        lines.push(Line::from(Span::styled(
            pad(&format!("  Closed {}", relative_time(s.last_turn_at)), full),
            dim,
        )));
        lines.push(Line::from(Span::styled(
            pad(&format!("  Created {}", relative_time(s.created_at)), full),
            dim,
        )));
        lines.push(Line::from(Span::styled(pad("", full), dim)));
    }
    frame.render_widget(
        Paragraph::new(lines).style(Style::default().bg(CARD_BG)),
        area,
    );

    // Scrollbar when there are more sessions than fit the pane.
    let total = picker.sessions.len();
    if total > visible {
        let mut state =
            ScrollbarState::new(total.saturating_sub(visible)).position(start);
        frame.render_stateful_widget(
            Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(None)
                .end_symbol(None)
                .thumb_style(Style::default().fg(if picker.preview_focus {
                    Color::Gray
                } else {
                    ACCENT
                }))
                .track_style(Style::default().fg(Color::DarkGray)),
            area,
            &mut state,
        );
    }
}

/// Render a session's transcript as markdown for the preview pane.
fn preview_markdown(messages: &[SerializedMessage]) -> String {
    if messages.is_empty() {
        return "*Empty session.*".to_string();
    }
    let mut out = String::new();
    for msg in messages {
        let who = if msg.role == "user" { "### 🧑 You" } else { "### 🤖 Assistant" };
        out.push_str(who);
        out.push('\n');
        for part in &msg.parts {
            match part.kind.as_str() {
                "code" => {
                    let lang = part.language.clone().unwrap_or_default();
                    let body = part.content.clone().unwrap_or_default();
                    out.push_str(&format!("```{lang}\n{body}\n```\n"));
                }
                "tool" => {
                    let name = part.tool.as_ref().map(|t| t.name.as_str()).unwrap_or("tool");
                    out.push_str(&format!("> 🔧 `{name}`\n"));
                }
                _ => {
                    if let Some(text) = &part.content {
                        out.push_str(text);
                        out.push('\n');
                    }
                }
            }
        }
        out.push_str("\n");
    }
    out
}

/// First visible index so the cursor stays in view within a `visible`-row window.
fn window_start(cursor: usize, len: usize, visible: usize) -> usize {
    if len <= visible {
        return 0;
    }
    cursor.saturating_sub(visible / 2).min(len - visible)
}

fn margin(area: Rect, dx: u16, dy: u16) -> Rect {
    Rect {
        x: area.x + dx,
        y: area.y + dy,
        width: area.width.saturating_sub(dx * 2),
        height: area.height.saturating_sub(dy * 2),
    }
}

/// Right-pad with spaces to `width` so a styled row's background fills the
/// whole column (a bare span only paints under its own text).
fn pad(s: &str, width: usize) -> String {
    let len = s.chars().count();
    if len >= width {
        return s.to_string();
    }
    format!("{s}{}", " ".repeat(width - len))
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{cut}…")
}

fn relative_time(ts_ms: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if ts_ms == 0 || ts_ms > now {
        return "just now".to_string();
    }
    let secs = (now - ts_ms) / 1000;
    if secs < 60 {
        "just now".to_string()
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else if secs < 86_400 {
        format!("{}h ago", secs / 3600)
    } else {
        format!("{}d ago", secs / 86_400)
    }
}
