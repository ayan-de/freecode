use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;
use tui_textarea::TextArea;

use crate::app::{App, Role, Status};

/// All layout, styling, and rendering lives here — this is the file to
/// gut when designing the real look. Nothing in app.rs or ipc/ depends
/// on how a frame is drawn.
pub fn draw(frame: &mut Frame, app: &App, input: &TextArea) {
    let area = frame.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(3),
            Constraint::Length(3),
        ])
        .split(area);

    draw_status_bar(frame, app, chunks[0]);
    draw_messages(frame, app, chunks[1]);
    draw_input(frame, input, chunks[2]);
}

fn draw_status_bar(frame: &mut Frame, app: &App, area: Rect) {
    let status = match app.status {
        Status::Idle => "idle",
        Status::Sending => "working…",
    };
    let text = format!(
        " freecode  ·  {}/{}  ·  {}",
        if app.provider.is_empty() { "-" } else { &app.provider },
        if app.model.is_empty() { "-" } else { &app.model },
        status
    );
    let bar = Paragraph::new(text).style(Style::default().bg(Color::DarkGray).fg(Color::White));
    frame.render_widget(bar, area);
}

fn draw_messages(frame: &mut Frame, app: &App, area: Rect) {
    let mut lines: Vec<Line> = Vec::new();
    for msg in &app.messages {
        let (label, color) = match msg.role {
            Role::User => ("you", Color::Cyan),
            Role::Assistant => ("ai", Color::Green),
            Role::System => ("sys", Color::DarkGray),
        };
        lines.push(Line::from(Span::styled(
            format!("{label}"),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        )));
        for line in msg.content.lines() {
            lines.push(Line::from(line.to_string()));
        }
        lines.push(Line::from(""));
    }

    let block = Block::default().borders(Borders::ALL).title(" chat ");
    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: false })
        .scroll((app.scroll, 0));
    frame.render_widget(paragraph, area);
}

fn draw_input(frame: &mut Frame, input: &TextArea, area: Rect) {
    frame.render_widget(input, area);
}
