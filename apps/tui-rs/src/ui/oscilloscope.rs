//! Compact braille "oscilloscope" used as the working-state indicator in the
//! status bar. It is not driven by real audio — the trace is a synthetic
//! sine+ripple scroll whose amplitude is scaled by the agent's activity
//! `energy` (streamed tokens / tool events), so it swells during bursts and
//! settles to a faint wobble in the gaps. One braille cell packs a 2×4 dot
//! grid, so an N-cell string is 2N horizontal samples at 4 vertical levels.

/// Left-column dot bits, top → bottom (braille dots 1, 2, 3, 7).
const LEFT: [u8; 4] = [0x01, 0x02, 0x04, 0x40];
/// Right-column dot bits, top → bottom (braille dots 4, 5, 6, 8).
const RIGHT: [u8; 4] = [0x08, 0x10, 0x20, 0x80];

/// Build a `cells`-wide braille waveform for the given `phase` (seconds) and
/// `energy` in [0, 1]. One dot is lit per sample column, tracing a line.
pub fn waveform(cells: usize, phase: f32, energy: f32) -> String {
    let mut s = String::with_capacity(cells);
    for c in 0..cells {
        let left = LEFT[level(sample((2 * c) as f32, phase, energy))];
        let right = RIGHT[level(sample((2 * c + 1) as f32, phase, energy))];
        // 0x2800 is the braille pattern block base; the low 8 bits pick dots.
        s.push(char::from_u32(0x2800 + (left | right) as u32).unwrap_or(' '));
    }
    s
}

/// Signal at horizontal sample `x` and time `phase`, in [-1, 1]. A slow carrier
/// plus a faster ripple gives the trace shape; `energy` sets the amplitude
/// (with a small floor so it never goes flat) and mixes in jitter when busy.
fn sample(x: f32, phase: f32, energy: f32) -> f32 {
    let carrier = (x * 0.55 + phase * 6.0).sin();
    let ripple = (x * 1.70 - phase * 9.0).sin() * 0.5;
    let amp = 0.18 + energy * 0.82;
    let jitter = (noise(x, phase) - 0.5) * energy * 0.4;
    (amp * (0.65 * carrier + 0.35 * ripple) + jitter).clamp(-1.0, 1.0)
}

/// Map a signal value in [-1, 1] to a vertical dot level: +1 → 0 (top),
/// -1 → 3 (bottom).
fn level(v: f32) -> usize {
    (((1.0 - v) * 0.5) * 3.0).round().clamp(0.0, 3.0) as usize
}

/// Stable pseudo-random float in [0, 1) from a sample column and a coarse time
/// bucket, so the jitter texture shifts a few times per second rather than
/// every frame. Same integer hash as the intro's scatter (no external deps).
fn noise(x: f32, phase: f32) -> f32 {
    let bucket = (phase * 18.0) as u32;
    let mut h = (x as u32).wrapping_mul(2_654_435_761) ^ bucket.wrapping_mul(0x9E37_79B9);
    h ^= h >> 15;
    h = h.wrapping_mul(0x85EB_CA6B);
    h ^= h >> 13;
    (h & 0xFFFF) as f32 / 65_535.0
}
