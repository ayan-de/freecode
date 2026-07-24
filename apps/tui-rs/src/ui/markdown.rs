//! Minimal markdown → ratatui renderer. Every current tui-markdown crate has
//! migrated to ratatui 0.30's `ratatui-core`, which is incompatible with the
//! 0.29 line/span types this app uses (pinned by tui-textarea). So, like jcode
//! and the TS TUI, we parse with pulldown-cmark and emit spans ourselves.
//! Covers the subset LLM answers actually use: headings, bold/italic, inline
//! code, fenced code blocks, and bullet/ordered lists.

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

const CODE: Color = Color::LightGreen;

pub fn render(md: &str) -> Vec<Line<'static>> {
    let parser = Parser::new_ext(md, Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES);
    let mut r = Renderer::default();
    for event in parser {
        r.event(event);
    }
    r.flush_line();
    r.lines
}

#[derive(Default)]
struct Renderer {
    lines: Vec<Line<'static>>,
    cur: Vec<Span<'static>>,
    style: Style,
    in_code_block: bool,
    /// Nesting: each entry is Some(next ordered index) or None for a bullet.
    lists: Vec<Option<u64>>,
    /// Table state: collected rows of plain-text cells, plus the in-progress cell.
    table: Option<Vec<Vec<String>>>,
    cell: String,
    /// Blockquote nesting depth; each flushed line gets a "▌ " marker.
    quote: usize,
    /// Destination of the link currently being rendered, appended on close.
    link: Option<String>,
}

impl Renderer {
    fn flush_line(&mut self) {
        if !self.cur.is_empty() {
            if self.quote > 0 {
                self.cur.insert(0, Span::styled(
                    "▌ ".repeat(self.quote),
                    Style::default().fg(Color::DarkGray),
                ));
            }
            self.lines.push(Line::from(std::mem::take(&mut self.cur)));
        }
    }

    fn blank(&mut self) {
        self.flush_line();
        // Avoid stacking multiple blanks.
        if self.lines.last().map(|l| l.width()).unwrap_or(1) != 0 {
            self.lines.push(Line::from(""));
        }
    }

    fn push_text(&mut self, text: &str) {
        self.cur
            .push(Span::styled(text.to_string(), self.style));
    }

    fn emit_table(&mut self) {
        let Some(rows) = self.table.take() else { return };
        if rows.is_empty() {
            return;
        }
        let cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
        let mut widths = vec![0usize; cols];
        for row in &rows {
            for (i, cell) in row.iter().enumerate() {
                widths[i] = widths[i].max(cell.chars().count());
            }
        }
        let render_row = |row: &[String]| {
            let cells: Vec<String> = (0..cols)
                .map(|i| {
                    let c = row.get(i).map(String::as_str).unwrap_or("");
                    format!("{c:<w$}", w = widths[i])
                })
                .collect();
            format!("│ {} │", cells.join(" │ "))
        };
        for (i, row) in rows.iter().enumerate() {
            self.lines.push(Line::from(render_row(row)));
            if i == 0 {
                let sep: Vec<String> = widths.iter().map(|w| "─".repeat(w + 2)).collect();
                self.lines.push(Line::from(Span::styled(
                    format!("├{}┤", sep.join("┼")),
                    Style::default().fg(Color::DarkGray),
                )));
            }
        }
        self.blank();
    }

    fn indent(&self) -> String {
        "  ".repeat(self.lists.len().saturating_sub(1))
    }

    fn event(&mut self, event: Event) {
        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(tag) => self.end(tag),
            Event::Text(text) => {
                if self.table.is_some() {
                    self.cell.push_str(&text);
                } else if self.in_code_block {
                    for (i, line) in text.split('\n').enumerate() {
                        if i > 0 {
                            self.flush_line();
                        }
                        self.cur.push(Span::styled(
                            format!("  {line}"),
                            Style::default().fg(CODE),
                        ));
                    }
                } else {
                    self.push_text(&text);
                }
            }
            Event::Code(code) => {
                if self.table.is_some() {
                    self.cell.push_str(&code);
                    return;
                }
                self.cur
                    .push(Span::styled(format!(" {code} "), Style::default().fg(CODE)));
            }
            Event::SoftBreak => self.push_text(" "),
            Event::HardBreak => self.flush_line(),
            Event::Rule => {
                self.blank();
                self.lines
                    .push(Line::from(Span::styled("───", Style::default().fg(Color::DarkGray))));
                self.blank();
            }
            _ => {}
        }
    }

    fn start(&mut self, tag: Tag) {
        match tag {
            Tag::Heading { level, .. } => {
                self.blank();
                let c = match level {
                    HeadingLevel::H1 => Color::Cyan,
                    HeadingLevel::H2 => Color::LightCyan,
                    _ => Color::Blue,
                };
                self.style = Style::default().fg(c).add_modifier(Modifier::BOLD);
            }
            Tag::Strong => self.style = self.style.add_modifier(Modifier::BOLD),
            Tag::Emphasis => self.style = self.style.add_modifier(Modifier::ITALIC),
            Tag::Strikethrough => self.style = self.style.add_modifier(Modifier::CROSSED_OUT),
            Tag::CodeBlock(kind) => {
                self.blank();
                self.in_code_block = true;
                if let CodeBlockKind::Fenced(lang) = kind {
                    if !lang.is_empty() {
                        self.lines.push(Line::from(Span::styled(
                            format!("  {lang}"),
                            Style::default().fg(Color::DarkGray),
                        )));
                    }
                }
            }
            Tag::Table(_) => {
                self.blank();
                self.table = Some(Vec::new());
            }
            Tag::TableHead | Tag::TableRow => {
                if let Some(rows) = self.table.as_mut() {
                    rows.push(Vec::new());
                }
            }
            Tag::TableCell => self.cell.clear(),
            Tag::BlockQuote(_) => {
                self.blank();
                self.quote += 1;
            }
            Tag::Link { dest_url, .. } => self.link = Some(dest_url.into_string()),
            Tag::List(start) => self.lists.push(start),
            Tag::Item => {
                self.flush_line();
                let marker = match self.lists.last_mut() {
                    Some(Some(n)) => {
                        let m = format!("{n}. ");
                        *n += 1;
                        m
                    }
                    _ => "• ".to_string(),
                };
                self.cur.push(Span::styled(
                    format!("{}{marker}", self.indent()),
                    Style::default().fg(Color::Yellow),
                ));
            }
            _ => {}
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Heading(_) => {
                self.flush_line();
                self.style = Style::default();
            }
            TagEnd::Strong => self.style = self.style.remove_modifier(Modifier::BOLD),
            TagEnd::Emphasis => self.style = self.style.remove_modifier(Modifier::ITALIC),
            TagEnd::Strikethrough => self.style = self.style.remove_modifier(Modifier::CROSSED_OUT),
            TagEnd::Paragraph => self.blank(),
            TagEnd::CodeBlock => {
                self.flush_line();
                self.in_code_block = false;
                self.blank();
            }
            TagEnd::List(_) => {
                self.lists.pop();
                if self.lists.is_empty() {
                    self.blank();
                }
            }
            TagEnd::BlockQuote(_) => {
                self.quote = self.quote.saturating_sub(1);
                if self.quote == 0 {
                    self.blank();
                }
            }
            TagEnd::Link => {
                if let Some(url) = self.link.take() {
                    if self.table.is_some() {
                        return;
                    }
                    self.cur.push(Span::styled(
                        format!(" ({url})"),
                        Style::default().fg(Color::Blue).add_modifier(Modifier::UNDERLINED),
                    ));
                }
            }
            TagEnd::TableCell => {
                if let Some(row) = self.table.as_mut().and_then(|r| r.last_mut()) {
                    row.push(std::mem::take(&mut self.cell).trim().to_string());
                }
            }
            TagEnd::Table => self.emit_table(),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ponytail: one check that the state machine emits, styles, and doesn't panic
    // on the constructs LLM answers actually mix.
    #[test]
    fn renders_common_markdown() {
        let lines = render("# Title\n\nHello **bold** and `code`.\n\n- one\n- two\n\n```rs\nfn x() {}\n```");
        let text: String = lines
            .iter()
            .map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.contains("Title"));
        assert!(text.contains("bold"));
        assert!(text.contains("• one"));
        assert!(text.contains("fn x() {}"));
        // bold span carries the BOLD modifier
        let has_bold = lines.iter().flat_map(|l| &l.spans).any(|s| {
            s.content.contains("bold") && s.style.add_modifier.contains(Modifier::BOLD)
        });
        assert!(has_bold);
    }

    #[test]
    fn renders_table() {
        let lines = render("| # | Command |\n|---|---------|\n| 1 | /help |\n| 2 | /quit |");
        let text: String = lines
            .iter()
            .map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.contains("│ 1 │ /help"), "got:\n{text}");
        assert!(text.contains("├"));
    }

    #[test]
    fn renders_quote_and_link() {
        let lines = render("> a quote\n\nsee [docs](http://x.io)");
        let text: String = lines
            .iter()
            .map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.contains("▌ a quote"), "got:\n{text}");
        assert!(text.contains("docs (http://x.io)"), "got:\n{text}");
    }
}
