// CANDIDATE — edit only this file.
//
// Contract: see baseline.rs. Must accept the same input format and produce the
// same output (including errors). Output buffer is pre-allocated and reused.
//
// Run `cargo test -p jcode-bench json_unescape` and
// `cargo bench --bench json_unescape` to evaluate.

#[inline(always)]
fn hex_nybble(b: u8) -> Option<u32> {
    match b {
        b'0'..=b'9' => Some((b - b'0') as u32),
        b'a'..=b'f' => Some((b - b'a' + 10) as u32),
        b'A'..=b'F' => Some((b - b'A' + 10) as u32),
        _ => None,
    }
}

#[cold]
#[inline(never)]
fn fail(s: &'static str) -> String {
    s.into()
}

pub fn candidate_json_unescape(input: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
    out.clear();
    let mut i = 0;
    let n = input.len();
    while i < n {
        let b = input[i];
        if b != b'\\' {
            out.push(b);
            i += 1;
            continue;
        }
        // Need to handle escape.
        if i + 1 >= n {
            return Err(fail("trailing backslash"));
        }
        let esc = input[i + 1];
        match esc {
            b'"' => { out.push(b'"'); i += 2; }
            b'\\' => { out.push(b'\\'); i += 2; }
            b'/' => { out.push(b'/'); i += 2; }
            b'n' => { out.push(b'\n'); i += 2; }
            b'r' => { out.push(b'\r'); i += 2; }
            b't' => { out.push(b'\t'); i += 2; }
            b'b' => { out.push(0x08); i += 2; }
            b'f' => { out.push(0x0C); i += 2; }
            b'u' => {
                if i + 6 > n {
                    return Err(fail("short \\u escape"));
                }
                let h0 = match hex_nybble(input[i + 2]) { Some(v) => v, None => return Err(fail("bad hex digits")) };
                let h1 = match hex_nybble(input[i + 3]) { Some(v) => v, None => return Err(fail("bad hex digits")) };
                let h2 = match hex_nybble(input[i + 4]) { Some(v) => v, None => return Err(fail("bad hex digits")) };
                let h3 = match hex_nybble(input[i + 5]) { Some(v) => v, None => return Err(fail("bad hex digits")) };
                let cp = (h0 << 12) | (h1 << 8) | (h2 << 4) | h3;
                let mut scalar = cp;
                let mut advance;
                if (0xD800..=0xDBFF).contains(&cp) {
                    // high surrogate — expect low surrogate next
                    if i + 12 > n || input[i + 6] != b'\\' || input[i + 7] != b'u' {
                        return Err(fail("lone high surrogate"));
                    }
                    let l0 = match hex_nybble(input[i + 8]) { Some(v) => v, None => return Err(fail("bad hex digits")) };
                    let l1 = match hex_nybble(input[i + 9]) { Some(v) => v, None => return Err(fail("bad hex digits")) };
                    let l2 = match hex_nybble(input[i + 10]) { Some(v) => v, None => return Err(fail("bad hex digits")) };
                    let l3 = match hex_nybble(input[i + 11]) { Some(v) => v, None => return Err(fail("bad hex digits")) };
                    let low = (l0 << 12) | (l1 << 8) | (l2 << 4) | l3;
                    if !(0xDC00..=0xDFFF).contains(&low) {
                        return Err(fail("invalid low surrogate"));
                    }
                    scalar = 0x10000 + (((cp - 0xD800) << 10) | (low - 0xDC00));
                    advance = 12;
                } else if (0xDC00..=0xDFFF).contains(&cp) {
                    return Err(fail("lone low surrogate"));
                } else {
                    advance = 6;
                }
                let ch = match char::from_u32(scalar) {
                    Some(c) => c,
                    None => return Err(fail("invalid scalar")),
                };
                let mut buf = [0u8; 4];
                let s = ch.encode_utf8(&mut buf);
                out.extend_from_slice(s.as_bytes());
                i += advance;
            }
            _ => return Err(fail("unknown escape")),
        }
    }
    Ok(())
}