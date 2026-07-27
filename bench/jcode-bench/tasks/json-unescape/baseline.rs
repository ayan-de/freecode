// BASELINE — naive JSON string unescaper. Agent must not edit.

/// Unescape the CONTENTS of a JSON string literal (without the surrounding quotes).
/// Input may contain `\\`, `\"`, `\n`, `\r`, `\t`, `\b`, `\f`, `\/`, and `\uXXXX`.
/// Surrogate pairs (`\uD800..\uDBFF` followed by `\uDC00..\uDFFF`) decode to a single
/// Unicode scalar value. Returns Err on invalid escape / lone surrogate.
pub fn baseline_json_unescape(input: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        let b = input[i];
        if b != b'\\' {
            out.push(b);
            i += 1;
            continue;
        }
        i += 1;
        if i >= input.len() {
            return Err("trailing backslash".into());
        }
        let esc = input[i];
        i += 1;
        match esc {
            b'"' => out.push(b'"'),
            b'\\' => out.push(b'\\'),
            b'/' => out.push(b'/'),
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'b' => out.push(0x08),
            b'f' => out.push(0x0C),
            b'u' => {
                if i + 4 > input.len() {
                    return Err("short \\u escape".into());
                }
                let hex = std::str::from_utf8(&input[i..i + 4])
                    .map_err(|e| format!("bad hex utf8: {}", e))?;
                let cp = u32::from_str_radix(hex, 16)
                    .map_err(|e| format!("bad hex digits: {}", e))?;
                i += 4;
                let mut scalar = cp;
                if (0xD800..=0xDBFF).contains(&cp) {
                    // high surrogate — expect low surrogate next
                    if i + 6 > input.len() || input[i] != b'\\' || input[i + 1] != b'u' {
                        return Err("lone high surrogate".into());
                    }
                    let hex2 = std::str::from_utf8(&input[i + 2..i + 6])
                        .map_err(|e| format!("bad hex utf8: {}", e))?;
                    let low = u32::from_str_radix(hex2, 16)
                        .map_err(|e| format!("bad hex digits: {}", e))?;
                    if !(0xDC00..=0xDFFF).contains(&low) {
                        return Err("invalid low surrogate".into());
                    }
                    scalar = 0x10000 + (((cp - 0xD800) << 10) | (low - 0xDC00));
                    i += 6;
                } else if (0xDC00..=0xDFFF).contains(&cp) {
                    return Err("lone low surrogate".into());
                }
                let ch = char::from_u32(scalar).ok_or_else(|| "invalid scalar".to_string())?;
                let mut buf = [0u8; 4];
                let s = ch.encode_utf8(&mut buf);
                out.extend_from_slice(s.as_bytes());
            }
            other => return Err(format!("unknown escape: {:?}", other as char)),
        }
    }
    Ok(out)
}