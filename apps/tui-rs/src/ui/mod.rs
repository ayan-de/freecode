use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
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
    if app.messages.is_empty() {
        draw_empty_state(frame, app, chunks[1]);
    } else {
        draw_messages(frame, app, chunks[1]);
    }
    draw_input(frame, app, input, chunks[2]);
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

fn dim() -> Style {
    Style::default().fg(Color::DarkGray)
}

fn abbreviate_home(path: &str) -> String {
    if let Some(home) = dirs_home() {
        if path == home {
            return "~".to_string();
        }
        if let Some(rest) = path.strip_prefix(&home) {
            return format!("~{rest}");
        }
    }
    path.to_string()
}

fn dirs_home() -> Option<String> {
    std::env::var("HOME").ok()
}

/// Centered status screen shown before the first message — server/client
/// identity, provider availability, and working dir at a glance, in the
/// vein of jcode's welcome header but backed only by data freecode actually
/// exposes over IPC (no fabricated MCP/skill counts).
fn draw_empty_state(frame: &mut Frame, app: &App, area: Rect) {
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(""));
    lines.push(
        Line::from(Span::styled("⟨tui-rs · dev⟩", dim())).alignment(Alignment::Center),
    );
    lines.push(
        Line::from(Span::styled(
            "freecode",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ))
        .alignment(Alignment::Center),
    );
    lines.push(
        Line::from(Span::styled(
            format!("client: freecode-tui · v{}", env!("CARGO_PKG_VERSION")),
            dim(),
        ))
        .alignment(Alignment::Center),
    );
    lines.push(Line::from(""));

    if !app.model.is_empty() {
        let mut spans = vec![Span::styled("● ", Style::default().fg(Color::Green))];
        if !app.provider.is_empty() {
            spans.push(Span::styled(format!("{} · ", app.provider), dim()));
        }
        spans.push(Span::styled(
            app.model.clone(),
            Style::default()
                .fg(Color::Magenta)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(" · /model to switch", dim()));
        lines.push(Line::from(spans).alignment(Alignment::Center));
    }

    lines.push(Line::from(Span::styled(
        format!("tools: {} loaded", app.tool_count),
        dim(),
    )).alignment(Alignment::Center));
    lines.push(Line::from(Span::styled("mcp: (none)", dim())).alignment(Alignment::Center));

    if !app.cwd.is_empty() {
        lines.push(Line::from(""));
        lines.push(
            Line::from(Span::styled(abbreviate_home(&app.cwd), dim()))
                .alignment(Alignment::Center),
        );
    }

    let paragraph = Paragraph::new(lines).alignment(Alignment::Center);
    frame.render_widget(paragraph, area);
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

/// Cycles the input prompt's number through a small palette so the composer
/// visibly changes color turn over turn instead of staying one flat color.
fn prompt_color(turn: usize) -> Color {
    const PALETTE: [Color; 5] = [
        Color::Cyan,
        Color::Magenta,
        Color::Yellow,
        Color::Green,
        Color::Blue,
    ];
    PALETTE[turn.saturating_sub(1) % PALETTE.len()]
}

fn draw_input(frame: &mut Frame, app: &App, input: &TextArea, area: Rect) {
    let next_prompt = app.next_prompt_number();
    let label = format!("{next_prompt}> ");
    let prefix_width = label.chars().count() as u16;

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(prefix_width), Constraint::Min(1)])
        .split(area);

    let prompt = Paragraph::new(Line::from(Span::styled(
        label,
        Style::default()
            .fg(prompt_color(next_prompt))
            .add_modifier(Modifier::BOLD),
    )));
    frame.render_widget(prompt, chunks[0]);
    frame.render_widget(input, chunks[1]);
}
