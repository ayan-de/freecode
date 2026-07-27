// Correctness gate for json-unescape: corpus of pathological inputs.

#[path = "baseline.rs"]
mod baseline;
#[path = "candidate.rs"]
mod candidate;

fn run_both(input: &[u8]) -> Result<(Vec<u8>, Vec<u8>), (String, String)> {
    let b = baseline::baseline_json_unescape(input);
    let mut c_out = Vec::with_capacity(input.len());
    let c = candidate::candidate_json_unescape(input, &mut c_out).map(|_| c_out);
    match (b, c) {
        (Ok(b), Ok(c)) => Ok((b, c)),
        (Err(be), Err(ce)) => Err((be, ce)),
        (Ok(_), Err(ce)) => Err(("ok-but-candidate-errored".into(), ce)),
        (Err(be), Ok(_)) => Err((be, "errored-but-candidate-ok".into())),
    }
}

#[test]
fn simple_escapes() {
    let cases: &[&[u8]] = &[
        b"",
        b"hello",
        b"hello\\nworld",
        b"tab\\there\\rCR\\bBS\\fFF",
        b"quote\\\"and\\\\slash\\/\\/",
        b"\\u0041\\u0042\\u0043",
        b"emoji \\uD83D\\uDE00 ok",
    ];
    for input in cases {
        let (b, c) = run_both(input).expect("both should succeed");
        assert_eq!(b, c, "mismatch on {:?}", input);
    }
}

#[test]
fn errors_match_baseline() {
    let bad: &[&[u8]] = &[
        b"\\",            // trailing backslash
        b"\\u00",         // short \u
        b"\\uXYZW",       // bad hex
        b"\\uD800",       // lone high surrogate
        b"\\uD800\\u0041", // high surrogate + non-low
        b"\\uDC00",       // lone low surrogate
        b"\\q",           // unknown escape
    ];
    for input in bad {
        let res = run_both(input);
        assert!(
            res.is_err(),
            "input {:?} — baseline rejected but candidate accepted",
            input
        );
    }
}

#[test]
fn large_randomized_round_trip() {
    // Generate 1000 random strings containing arbitrary scalars, escape them with
    // baseline (which is correct by construction), and verify candidate decodes
    // them back to the same bytes.
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut seed: u64 = 0xDEADBEEF;
    for trial in 0..1000 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let mut hasher = DefaultHasher::new();
        seed.hash(&mut hasher);
        let mut rand_state: u64 = hasher.finish();
        let mut next = || {
            rand_state = rand_state.wrapping_mul(6364136223846793005).wrapping_add(1);
            rand_state
        };

        let len = (next() as usize) % 200;
        let mut raw: Vec<u8> = Vec::with_capacity(len);
        for _ in 0..len {
            let r = next();
            // Choose: ASCII printable, escaped char, or surrogate pair.
            let kind = r % 3;
            let c = match kind {
                0 => (0x20 + (r >> 8) as u8 % 95) as char,
                1 => ['"', '\\', '/', 'n', 'r', 't', 'b', 'f']
                    [(r >> 16) as usize % 8],
                _ => char::from_u32(0xE000 + ((r >> 16) as u32 % 0x1000)).unwrap_or('?'),
            };
            for byte in c.to_string().as_bytes() {
                raw.push(*byte);
            }
        }
        // Escape using baseline (reverse direction) — write a JSON-escaped form.
        // Iterate over Unicode codepoints (chars), not bytes, so multi-byte UTF-8
        // sequences are escaped as a single `\uXXXX`.
        let mut escaped: Vec<u8> = Vec::with_capacity(raw.len() * 2);
        let raw_str = std::str::from_utf8(&raw).unwrap();
        for c in raw_str.chars() {
            match c {
                '"' => escaped.extend_from_slice(b"\\\""),
                '\\' => escaped.extend_from_slice(b"\\\\"),
                '\n' => escaped.extend_from_slice(b"\\n"),
                '\r' => escaped.extend_from_slice(b"\\r"),
                '\t' => escaped.extend_from_slice(b"\\t"),
                '\x08' => escaped.extend_from_slice(b"\\b"),
                '\x0c' => escaped.extend_from_slice(b"\\f"),
                '/' => escaped.extend_from_slice(b"\\/"),
                c if (0x20..=0x7E).contains(&(c as u32)) => {
                    escaped.push(c as u8);
                }
                _ => {
                    let cp = c as u32;
                    if (0xD800..=0xDFFF).contains(&cp) {
                        // skip lone surrogates; valid JSON never carries them raw
                        continue;
                    }
                    escaped.extend_from_slice(format!("\\u{:04X}", cp).as_bytes());
                }
            }
        }
        let (b_decoded, c_decoded) =
            run_both(&escaped).unwrap_or_else(|_| panic!("trial {} baseline failed", trial));
        assert_eq!(b_decoded, raw, "trial {} baseline mismatch", trial);
        assert_eq!(c_decoded, raw, "trial {} candidate mismatch", trial);
    }
}