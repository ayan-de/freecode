//! Landing "particle materialize" logo — looping.
//!
//! Every non-space cell of the FreeCode logo is a particle with a deterministic
//! pseudo-random scatter origin (stable per cell, so there's zero frame-to-frame
//! flicker). The loop runs assemble → hold → disperse → gap forever: particles
//! fly in to spell the logo, hold assembled in brand colour — pink for the
//! "Free" half, cyan for "Code", matching the static gradient — then scatter
//! back out before repeating.
//!
//! Rendering is done straight into the frame buffer at fixed coordinates, which
//! is what lets particles occupy arbitrary cells mid-flight (a `Paragraph` can
//! only center whole lines). The caller reserves the three logo rows as blanks,
//! so this overlay owns those cells alone; the surrounding text is untouched.

use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::Frame;

use super::{LOGO, LOGO_FREE_CHARS};

/// Loop phases (ms): fly in, hold assembled, fly out, then a brief scattered gap.
const ASSEMBLE_MS: f32 = 700.0;
const HOLD_MS: f32 = 1500.0;
const DISPERSE_MS: f32 = 700.0;
const GAP_MS: f32 = 400.0;
const CYCLE_MS: f32 = ASSEMBLE_MS + HOLD_MS + DISPERSE_MS + GAP_MS;

const LOGO_W: u16 = 34;
const LOGO_ROWS: u16 = 3;

/// Draw the looping logo into `area`. `logo_top` is the absolute row of the
/// logo's first line (the caller knows it from paragraph layout).
pub fn draw_logo(frame: &mut Frame, area: Rect, logo_top: u16, elapsed_ms: f32) {
    // Too narrow to center the logo — skip the overlay this frame.
    if area.width < LOGO_W {
        return;
    }

    // Global assemble progress in [0, 1]: 0 = fully scattered, 1 = assembled.
    let assembled = cycle_progress(elapsed_ms.rem_euclid(CYCLE_MS));
    let eased = ease_in_out(assembled);

    let logo_x0 = area.x + (area.width - LOGO_W) / 2;
    let buf = frame.buffer_mut();

    for (r, row) in LOGO.iter().enumerate() {
        for (c, ch) in row.chars().enumerate() {
            if ch == ' ' {
                continue;
            }
            let target_x = logo_x0 as f32 + c as f32;
            let target_y = (logo_top + r as u16) as f32;

            // Scatter origin: a stable pseudo-random direction per cell.
            let (a, b) = rand2((r * LOGO_W as usize + c) as u32);
            let angle = a * std::f32::consts::TAU;
            let radius = 6.0 + b * 12.0;
            // Halve the vertical throw — terminal cells are ~twice as tall as
            // wide, so an even visual scatter needs less y displacement.
            let start_x = target_x + angle.cos() * radius;
            let start_y = target_y + angle.sin() * radius * 0.5;

            let x = lerp(start_x, target_x, eased).round();
            let y = lerp(start_y, target_y, eased).round();
            if x < area.left() as f32
                || x >= area.right() as f32
                || y < area.top() as f32
                || y >= area.bottom() as f32
            {
                continue;
            }

            let style = if assembled >= 0.98 {
                brand_style(c)
            } else {
                // In flight: dim grey, brightening as it nears home.
                let m = if eased > 0.75 { Modifier::empty() } else { Modifier::DIM };
                Style::default().fg(Color::DarkGray).add_modifier(m)
            };
            buf[(x as u16, y as u16)].set_char(ch).set_style(style);
        }
    }
}

/// Trapezoid over one cycle: ramp up over `ASSEMBLE_MS`, hold at 1 through
/// `HOLD_MS`, ramp down over `DISPERSE_MS`, then rest at 0 for `GAP_MS`.
fn cycle_progress(local: f32) -> f32 {
    if local < ASSEMBLE_MS {
        local / ASSEMBLE_MS
    } else if local < ASSEMBLE_MS + HOLD_MS {
        1.0
    } else if local < ASSEMBLE_MS + HOLD_MS + DISPERSE_MS {
        1.0 - (local - ASSEMBLE_MS - HOLD_MS) / DISPERSE_MS
    } else {
        0.0
    }
}

/// The reserved height (in rows) the caller must leave blank for the logo.
pub const fn logo_height() -> u16 {
    LOGO_ROWS
}

fn brand_style(col: usize) -> Style {
    let color = if col < LOGO_FREE_CHARS {
        Color::Rgb(255, 105, 180)
    } else {
        Color::Cyan
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Smooth ease on both ends, so assemble and disperse both decelerate nicely.
fn ease_in_out(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// Two stable pseudo-random floats in `[0, 1)` from a cell index. Deterministic
/// so the scatter pattern is identical every frame (no flicker).
fn rand2(seed: u32) -> (f32, f32) {
    let mut h = seed.wrapping_mul(2_654_435_761) ^ 0x9E37_79B9;
    h ^= h >> 15;
    h = h.wrapping_mul(0x85EB_CA6B);
    h ^= h >> 13;
    let a = (h & 0xFFFF) as f32 / 65_535.0;
    let b = ((h >> 16) & 0xFFFF) as f32 / 65_535.0;
    (a, b)
}
