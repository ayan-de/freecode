use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::io::Write;

/// Historical safe ceiling for OSC 52 payloads across common terminals.
pub const OSC52_CAP_BASE64_BYTES: usize = 100 * 1024;

pub struct CopyResult {
    pub copied: String,
    pub truncated: bool,
}

fn base64_encode(text: &str) -> String {
    STANDARD.encode(text.as_bytes())
}

fn base64_len(text: &str) -> usize {
    base64_encode(text).len()
}

/// Head-truncates `text` (on a char boundary) so its base64 encoding fits
/// within the cap.
fn truncate_to_cap(text: &str) -> (String, bool) {
    if base64_len(text) <= OSC52_CAP_BASE64_BYTES {
        return (text.to_string(), false);
    }
    let chars: Vec<char> = text.chars().collect();
    let mut lo = 0usize;
    let mut hi = chars.len();
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        let candidate: String = chars[..mid].iter().collect();
        if base64_len(&candidate) <= OSC52_CAP_BASE64_BYTES {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    (chars[..lo].iter().collect(), true)
}

/// Wraps an OSC sequence for tmux passthrough: doubles the inner ESC and
/// frames it as a tmux DCS passthrough sequence (`allow-passthrough`).
fn wrap_for_tmux(seq: &str) -> String {
    format!("\x1bPtmux;{}\x1b\\", seq.replace('\x1b', "\x1b\x1b"))
}

pub fn copy_to_clipboard(
    text: &str,
    write: &mut dyn Write,
    tmux: bool,
) -> std::io::Result<CopyResult> {
    let (capped, truncated) = truncate_to_cap(text);
    let seq = format!("\x1b]52;c;{}\x07", base64_encode(&capped));
    let sequence = if tmux { wrap_for_tmux(&seq) } else { seq };
    write.write_all(sequence.as_bytes())?;
    Ok(CopyResult {
        copied: capped,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_bare_osc52_outside_tmux() {
        let mut buf: Vec<u8> = Vec::new();
        let result = copy_to_clipboard("hello", &mut buf, false).unwrap();
        assert_eq!(result.copied, "hello");
        assert!(!result.truncated);
        let expected = format!("\x1b]52;c;{}\x07", base64_encode("hello"));
        assert_eq!(String::from_utf8(buf).unwrap(), expected);
    }

    #[test]
    fn wraps_for_tmux_passthrough() {
        let mut buf: Vec<u8> = Vec::new();
        copy_to_clipboard("hi", &mut buf, true).unwrap();
        let inner = format!("\x1b]52;c;{}\x07", base64_encode("hi"));
        let expected = format!("\x1bPtmux;{}\x1b\\", inner.replace('\x1b', "\x1b\x1b"));
        assert_eq!(String::from_utf8(buf).unwrap(), expected);
    }

    #[test]
    fn head_truncates_over_the_cap() {
        let mut buf: Vec<u8> = Vec::new();
        let big = "x".repeat(OSC52_CAP_BASE64_BYTES);
        let result = copy_to_clipboard(&big, &mut buf, false).unwrap();
        assert!(result.truncated);
        assert!(result.copied.len() < big.len());
        assert!(big.starts_with(&result.copied));
    }

    #[test]
    fn does_not_truncate_under_the_cap() {
        let mut buf: Vec<u8> = Vec::new();
        let result = copy_to_clipboard("short text", &mut buf, false).unwrap();
        assert!(!result.truncated);
        assert_eq!(result.copied, "short text");
    }
}
