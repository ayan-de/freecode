mod markdown;
mod prompt;
mod tool;
mod oscilloscope;
pub mod intro;
pub mod status;

use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;
use tui_textarea::TextArea;

use crate::app::{App, Role};

/// All layout, styling, and rendering lives here — this is the file to
/// gut when designing the real look. Nothing in app.rs or ipc/ depends
/// on how a frame is drawn.
pub fn draw(frame: &mut Frame, app: &mut App, input: &TextArea) {
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
    // Drawn last so it sits above the transcript and the composer — core is
    // blocked until it is answered.
    if let Some(p) = &app.prompt {
        prompt::draw(frame, p, chunks[1]);
    }
}

fn draw_status_bar(frame: &mut Frame, app: &App, area: Rect) {
    let center = status::center_segment(
        &app.provider,
        &app.model,
        app.status,
        app.osc_phase(),
        app.energy(),
    );
    let line = status::render(area.width, app.mode, app.context, &center);
    // Set bg on the Paragraph too — every span carries it as well, but the
    // widget-level style covers any cell that might fall outside the line's
    // measured width (defensive against width=0 or future truncation).
    let bar = Paragraph::new(line).style(Style::default().bg(status::status_bg()));
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

/// ASCII logo mirrored from `apps/tui/src/assets/logo.ts`. Each line is 34
/// characters wide; the first 17 characters render "Free" in pink, the
/// remaining 17 characters render "Code" in cyan. Box-drawing chars are
/// 3 bytes each in UTF-8, so the split has to be on a character boundary
/// rather than a byte offset.
const LOGO: [&str; 3] = [
    "█▀▀ █▀▀█ █▀▀ █▀▀ █▀▀ █▀▀█ █▀▀▄ █▀▀",
    "█▀▀ █▄▄▀ █▀▀ █▀▀ █▒▒ █▒▒█ █▒▒█ █▀▀",
    "▀   ▀ ▀▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀",
];
const LOGO_FREE_CHARS: usize = 17;

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

    // The logo animates on a loop while the transcript is empty. During that
    // time reserve its rows as blanks so `intro::draw_logo` owns those cells;
    // all surrounding text stays exactly as it is. When the intro is inactive
    // (a message exists), the logo renders as the static gradient below.
    let intro_active = app.intro_active();
    if intro_active {
        for _ in 0..intro::logo_height() {
            lines.push(Line::from(""));
        }
    } else {
        let pink = Style::default()
            .fg(Color::Rgb(255, 105, 180))
            .add_modifier(Modifier::BOLD);
        let cyan = Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD);
        for line in LOGO {
            // `split_at` requires a byte index on a char boundary; the box-drawing
            // characters in LOGO are 3 bytes each, so count chars and project to
            // the byte offset of the 17th char.
            let split_byte = line
                .char_indices()
                .nth(LOGO_FREE_CHARS)
                .map(|(i, _)| i)
                .unwrap_or(line.len());
            let (free, code) = line.split_at(split_byte);
            lines.push(
                Line::from(vec![
                    Span::styled(free, pink),
                    Span::styled(code, cyan),
                ])
                .alignment(Alignment::Center),
            );
        }
    }
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

    // Overlay the looping logo onto the reserved rows (index 2..5 of the
    // paragraph: one blank + the "⟨tui-rs · dev⟩" line precede it).
    if intro_active {
        intro::draw_logo(frame, area, area.y + 2, app.intro_elapsed_ms());
    }
}

fn draw_messages(frame: &mut Frame, app: &mut App, area: Rect) {
    let mut lines: Vec<Line> = Vec::new();
    let mut user_turn = 0usize;
    for msg in &app.messages {
        match msg.role {
            // User prompts render inline as "N> text" on a dark-grey bar,
            // mirroring the composer's "N>" prompt so the turn persists.
            Role::User => {
                user_turn += 1;
                let bg = Style::default().bg(Color::Rgb(60, 60, 60)).fg(Color::White);
                let prefix = format!("{user_turn}❯ ");
                let pad = " ".repeat(prefix.chars().count());
                let mut first = true;
                for line in msg.content.lines() {
                    let head = if first { &prefix } else { &pad };
                    lines.push(Line::from(Span::styled(format!("{head}{line}"), bg)));
                    first = false;
                }
            }
            Role::Tool => {
                if let Some(call) = &msg.tool {
                    lines.extend(tool::render(call, app.osc_phase(), app.tools_expanded));
                }
            }
            Role::System => {
                lines.push(Line::from(Span::styled("·", dim())));
                for line in msg.content.lines() {
                    lines.push(Line::from(Span::styled(line.to_string(), dim())));
                }
            }
            Role::Assistant => {
                lines.push(Line::from(Span::styled(
                    "●",
                    Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
                )));

                // Reasoning phase, "Thinking..." over dim-yellow rules.
                if !msg.thinking.is_empty() {
                    lines.push(Line::from(Span::styled(
                        "Thinking…",
                        Style::default().fg(Color::Cyan),
                    )));
                    let think = Style::default().fg(Color::Cyan).add_modifier(Modifier::DIM);
                    for line in msg.thinking.lines() {
                        lines.push(Line::from(vec![
                            Span::styled("  │ ", think),
                            Span::styled(line.to_string(), think),
                        ]));
                    }
                    lines.push(Line::from(""));
                }

                lines.extend(markdown::render(&msg.content));
            }
        }
        lines.push(Line::from(""));
    }

    let paragraph = Paragraph::new(lines).wrap(Wrap { trim: false });

    // Clamp scroll to the real wrapped height; follow the bottom until the
    // user scrolls away, and re-arm follow once they scroll back down to it.
    let total = paragraph.line_count(area.width) as u16;
    let max = total.saturating_sub(area.height);
    if app.follow {
        app.scroll = max;
    } else if app.scroll >= max {
        app.scroll = max;
        app.follow = true;
    }

    frame.render_widget(paragraph.scroll((app.scroll, 0)), area);
}

fn draw_input(frame: &mut Frame, app: &App, input: &TextArea, area: Rect) {
    let next_prompt = app.next_prompt_number();
    let number = next_prompt.to_string();
    let prefix_width = (number.chars().count() + 2) as u16;

    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(prefix_width), Constraint::Min(1)])
        .split(area);

    let prompt = Paragraph::new(Line::from(vec![
        Span::styled(
            number,
            Style::default()
                .fg(Color::Rgb(255, 105, 180))
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "❯ ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
    ]));
    frame.render_widget(prompt, chunks[0]);
    frame.render_widget(input, chunks[1]);
}
