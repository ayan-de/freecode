//! The `/usage` dashboard: a stat row, a 30-day sparkline, and three months of
//! GitHub-style calendar heatmap. The calendar is ratatui's own `Monthly`
//! widget (feature `widget-calendar`) driven by a `CalendarEventStore` that
//! maps each day to a bucket color — no hand-rolled date math or grid layout.

use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::calendar::{CalendarEventStore, Monthly};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Sparkline};
use ratatui::Frame;
use time::{Date, Month};

use crate::ipc::protocol::DailyUsage;

const ACCENT: Color = Color::Rgb(245, 199, 26);
const CARD_BG: Color = Color::Rgb(30, 30, 34);

/// Empty → hottest. Mirrors the TS TUI's `/usage` heatmap theme so the two
/// frontends read the same.
const BUCKETS: [Color; 5] = [
    Color::Rgb(45, 45, 45),
    Color::Rgb(130, 102, 10),
    Color::Rgb(194, 153, 15),
    Color::Rgb(220, 174, 21),
    Color::Rgb(245, 199, 26),
];

/// How many months of calendar to show, most recent last.
const MONTHS: usize = 3;
/// How many days the sparkline covers.
const SPARK_DAYS: usize = 30;

pub fn draw(frame: &mut Frame, days: &[DailyUsage], area: Rect) {
    // 17 = borders(2) + stats(2) + sparkline(4) + calendar(8: month + weekday
    // header + up to 6 week rows) + legend(1).
    let card = centered(area, 76, 17);
    frame.render_widget(Clear, card);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(ACCENT))
        .title(Span::styled(
            " Token usage ",
            Style::default()
                .bg(ACCENT)
                .fg(Color::Black)
                .add_modifier(Modifier::BOLD),
        ))
        .title_bottom(
            Line::from(Span::styled(
                " any key to close ",
                Style::default().fg(Color::Gray).bg(CARD_BG),
            ))
            .alignment(Alignment::Right),
        )
        .style(Style::default().bg(CARD_BG));
    let inner = block.inner(card);
    frame.render_widget(block, card);

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2), // stats
            Constraint::Length(4), // sparkline
            Constraint::Min(8),    // calendars
            Constraint::Length(1), // legend
        ])
        .split(inner);

    draw_stats(frame, days, rows[0]);
    draw_sparkline(frame, days, rows[1]);
    draw_calendars(frame, days, rows[2]);
    draw_legend(frame, rows[3]);
}

fn draw_stats(frame: &mut Frame, days: &[DailyUsage], area: Rect) {
    let total: u64 = days.iter().map(|d| d.tokencount).sum();
    let recent: u64 = tail(days, SPARK_DAYS).iter().map(|d| d.tokencount).sum();
    let last = days.last().map(|d| d.tokencount).unwrap_or(0);
    let peak = days.iter().map(|d| d.tokencount).max().unwrap_or(0);

    let stat = |label: &str, value: u64| {
        vec![
            Span::styled(format!(" {label} "), Style::default().fg(Color::Gray)),
            Span::styled(
                compact(value),
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::raw("   "),
        ]
    };
    let mut spans = Vec::new();
    spans.extend(stat("Latest day", last));
    spans.extend(stat("Last 30d", recent));
    spans.extend(stat("Peak day", peak));
    spans.extend(stat("All time", total));

    frame.render_widget(
        Paragraph::new(Line::from(spans)).style(Style::default().bg(CARD_BG)),
        area,
    );
}

fn draw_sparkline(frame: &mut Frame, days: &[DailyUsage], area: Rect) {
    let recent = tail(days, SPARK_DAYS);
    let data: Vec<u64> = recent.iter().map(|d| d.tokencount).collect();
    let block = Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(Span::styled(
            format!(" last {} days ", data.len().max(1)),
            Style::default().fg(Color::Gray),
        ))
        .style(Style::default().bg(CARD_BG));
    frame.render_widget(
        Sparkline::default()
            .block(block)
            .data(&data)
            .style(Style::default().fg(ACCENT).bg(CARD_BG)),
        area,
    );
}

fn draw_calendars(frame: &mut Frame, days: &[DailyUsage], area: Rect) {
    // Scale is global across the shown months so colors are comparable.
    let max = days.iter().map(|d| d.tokencount).max().unwrap_or(0).max(1);
    let mut events = CalendarEventStore::default();
    for day in days {
        if let Some(date) = parse_date(&day.date) {
            events.add(
                date,
                Style::default()
                    .bg(BUCKETS[bucket(day.tokencount, max)])
                    .fg(Color::Black),
            );
        }
    }

    // Anchor on the most recent day with data; without data there is nothing
    // meaningful to anchor on, so skip the calendars entirely.
    let Some(anchor) = days.last().and_then(|d| parse_date(&d.date)) else {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                "  No usage recorded yet.",
                Style::default().fg(Color::DarkGray),
            )))
            .style(Style::default().bg(CARD_BG)),
            area,
        );
        return;
    };

    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Ratio(1, MONTHS as u32); MONTHS])
        .split(area);

    for (i, col) in cols.iter().enumerate() {
        // Oldest month leftmost: the last column is the anchor month.
        let back = (MONTHS - 1 - i) as i32;
        let Some(month_start) = months_before(anchor, back) else {
            continue;
        };
        frame.render_widget(
            Monthly::new(month_start, &events)
                .show_month_header(Style::default().fg(ACCENT).add_modifier(Modifier::BOLD))
                .show_weekdays_header(Style::default().fg(Color::DarkGray))
                .default_style(Style::default().bg(CARD_BG).fg(Color::DarkGray)),
            *col,
        );
    }
}

fn draw_legend(frame: &mut Frame, area: Rect) {
    let mut spans = vec![Span::styled(" Less ", Style::default().fg(Color::Gray))];
    for color in BUCKETS {
        spans.push(Span::styled("  ", Style::default().bg(color)));
        spans.push(Span::raw(" "));
    }
    spans.push(Span::styled("More", Style::default().fg(Color::Gray)));
    frame.render_widget(
        Paragraph::new(Line::from(spans))
            .alignment(Alignment::Right)
            .style(Style::default().bg(CARD_BG)),
        area,
    );
}

/// Bucket index into [`BUCKETS`]: 0 for a day with no tokens, else 1..=4 scaled
/// against `max` so the busiest day is always the hottest color.
fn bucket(tokens: u64, max: u64) -> usize {
    if tokens == 0 {
        return 0;
    }
    // Ceiling division keeps any non-zero day at least one shade above empty.
    (((tokens * 4).div_ceil(max)) as usize).clamp(1, 4)
}

/// Parse core's `YYYY-MM-DD`. Returns `None` for anything malformed rather than
/// guessing — a bad row is simply not painted.
fn parse_date(s: &str) -> Option<Date> {
    let mut parts = s.split('-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u8 = parts.next()?.parse().ok()?;
    let day: u8 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Date::from_calendar_date(year, Month::try_from(month).ok()?, day).ok()
}

/// The 1st of the month `back` months before `date`.
fn months_before(date: Date, back: i32) -> Option<Date> {
    let total = date.year() * 12 + (date.month() as i32 - 1) - back;
    let month = Month::try_from((total.rem_euclid(12) + 1) as u8).ok()?;
    Date::from_calendar_date(total.div_euclid(12), month, 1).ok()
}

/// The last `n` entries, or all of them when there are fewer.
fn tail(days: &[DailyUsage], n: usize) -> &[DailyUsage] {
    &days[days.len().saturating_sub(n)..]
}

/// `12.3k` / `1.2M` — the stat row has no room for full thousands separators.
fn compact(n: u64) -> String {
    match n {
        0..=999 => n.to_string(),
        1_000..=999_999 => format!("{:.1}k", n as f64 / 1_000.0),
        _ => format!("{:.1}M", n as f64 / 1_000_000.0),
    }
}

fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let w = width.min(area.width);
    let h = height.min(area.height);
    Rect {
        x: area.x + (area.width - w) / 2,
        y: area.y + (area.height - h) / 2,
        width: w,
        height: h,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole point of the dashboard is the colored heatmap, so assert it
    /// actually paints: a busy day, a quiet day and an empty day must land on
    /// three different bucket backgrounds in the rendered buffer.
    #[test]
    fn renders_distinct_heatmap_colors() {
        use ratatui::backend::TestBackend;
        use ratatui::Terminal;
        use std::collections::HashSet;

        let days = vec![
            DailyUsage { date: "2026-07-01".into(), tokencount: 100_000 },
            DailyUsage { date: "2026-07-02".into(), tokencount: 0 },
            DailyUsage { date: "2026-07-03".into(), tokencount: 10_000 },
        ];
        let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
        terminal
            .draw(|frame| draw(frame, &days, frame.area()))
            .unwrap();

        let backgrounds: HashSet<Color> =
            terminal.backend().buffer().content().iter().map(|c| c.bg).collect();
        for (i, color) in [BUCKETS[0], BUCKETS[1], BUCKETS[4]].iter().enumerate() {
            assert!(backgrounds.contains(color), "bucket color {i} missing from frame");
        }
    }

    #[test]
    fn buckets_span_empty_to_hottest() {
        assert_eq!(bucket(0, 100), 0, "no tokens is the empty shade");
        assert_eq!(bucket(1, 100), 1, "any activity clears the empty shade");
        assert_eq!(bucket(50, 100), 2);
        assert_eq!(bucket(100, 100), 4, "the busiest day is the hottest shade");
    }

    #[test]
    fn parses_core_dates_and_rejects_junk() {
        let d = parse_date("2026-07-28").expect("valid date");
        assert_eq!((d.year(), d.month() as u8, d.day()), (2026, 7, 28));
        assert!(parse_date("2026-13-01").is_none(), "month out of range");
        assert!(parse_date("2026-07").is_none(), "missing day");
        assert!(parse_date("2026-07-28-1").is_none(), "trailing junk");
    }

    #[test]
    fn months_before_walks_across_the_year_boundary() {
        let jan = parse_date("2026-01-15").unwrap();
        let two_back = months_before(jan, 2).unwrap();
        assert_eq!((two_back.year(), two_back.month() as u8, two_back.day()), (2025, 11, 1));
        let same = months_before(jan, 0).unwrap();
        assert_eq!((same.year(), same.month() as u8, same.day()), (2026, 1, 1));
    }

    #[test]
    fn compact_and_tail() {
        assert_eq!(compact(999), "999");
        assert_eq!(compact(12_345), "12.3k");
        assert_eq!(compact(1_200_000), "1.2M");

        let days: Vec<DailyUsage> = (1..=5)
            .map(|i| DailyUsage { date: format!("2026-07-0{i}"), tokencount: i })
            .collect();
        assert_eq!(tail(&days, 2).len(), 2);
        assert_eq!(tail(&days, 99).len(), 5, "fewer entries than asked for is fine");
    }
}
