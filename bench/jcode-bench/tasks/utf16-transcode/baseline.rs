// BASELINE — naive UTF-16 → UTF-8 transcoder. Agent must not edit.
//
// UTF-16 is variable-width: BMP scalars are one code unit, supplementary-plane
// scalars are a high+low surrogate pair. A lone/mismatched surrogate is an error.
// This uses std's `decode_utf16` (correct but naive: char-by-char, per-char
// stack buffer, no bulk ASCII fast path) as the oracle to beat.
pub fn baseline_utf16_to_utf8(input: &[u16]) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len());
    for unit in char::decode_utf16(input.iter().copied()) {
        match unit {
            Ok(c) => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
            Err(_) => return Err("invalid utf-16".into()),
        }
    }
    Ok(out)
}
