#[path = "baseline.rs"]
mod baseline;
#[path = "candidate.rs"]
mod candidate;

fn run_both(input: &[u16]) -> Result<(Vec<u8>, Vec<u8>), (String, String)> {
    let b = baseline::baseline_utf16_to_utf8(input);
    let mut c_out = Vec::with_capacity(input.len());
    let c = candidate::candidate_utf16_to_utf8(input, &mut c_out).map(|_| c_out);
    match (b, c) {
        (Ok(b), Ok(c)) => Ok((b, c)),
        (Err(be), Err(ce)) => Err((be, ce)),
        (Ok(_), Err(ce)) => Err(("ok-but-candidate-errored".into(), ce)),
        (Err(be), Ok(_)) => Err((be, "errored-but-candidate-ok".into())),
    }
}

#[test]
fn ascii() {
    let input: Vec<u16> = "Hello, world!".encode_utf16().collect();
    let (b, c) = run_both(&input).unwrap();
    assert_eq!(b, c);
    assert_eq!(b, b"Hello, world!");
}

#[test]
fn bmp() {
    let input: Vec<u16> = "héllo — 你好".encode_utf16().collect();
    let (b, c) = run_both(&input).unwrap();
    assert_eq!(b, c);
    let s = std::str::from_utf8(&b).unwrap();
    assert_eq!(s, "héllo — 你好");
}

#[test]
fn supplementary_planes() {
    // 😀 (U+1F600) and 🦀 (U+1F980)
    let input: Vec<u16> = "😀🦀".encode_utf16().collect();
    let (b, c) = run_both(&input).unwrap();
    assert_eq!(b, c);
    assert_eq!(std::str::from_utf8(&b).unwrap(), "😀🦀");
}

#[test]
fn errors_match_baseline() {
    // Only genuinely malformed UTF-16 is an error. A single BMP unit like
    // [0x0041] ('A') is valid — length parity is meaningless for &[u16].
    let bad: &[&[u16]] = &[
        &[0xD800, 0x0041], // high surrogate followed by a non-low unit
        &[0xD800],         // lone high surrogate at end of input
        &[0xDC00],         // lone low surrogate
    ];
    for input in bad {
        assert!(run_both(input).is_err(), "input {:?} should be rejected", input);
    }
}

#[test]
fn large_randomized_round_trip() {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut seed: u64 = 0xC0FFEE;
    for _trial in 0..200 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let mut hasher = DefaultHasher::new();
        seed.hash(&mut hasher);
        let mut state: u64 = hasher.finish();
        let mut next = || {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            state
        };

        let n_chars = (next() as usize) % 256;
        let s: String = (0..n_chars)
            .map(|_| {
                let r = next();
                let cp = (r as u32) % 0x110000;
                char::from_u32(cp).unwrap_or('?')
            })
            .collect();
        let input: Vec<u16> = s.encode_utf16().collect();
        let oracle = String::from_utf16(&input).unwrap();
        let (b, c) = run_both(&input).unwrap();
        assert_eq!(std::str::from_utf8(&b).unwrap(), oracle);
        assert_eq!(std::str::from_utf8(&c).unwrap(), oracle);
    }
}