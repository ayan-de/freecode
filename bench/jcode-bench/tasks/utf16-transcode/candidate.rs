// CANDIDATE — edit only this file.
//
// Contract: see baseline.rs. Same input, same output (including the error case:
// any lone/mismatched surrogate => Err). The `out` buffer is pre-allocated and
// reused across calls for performance.
//
// This is a naive, correct starting line (equivalent to the baseline). Optimize
// it — e.g. bulk-copy runs of ASCII, decode surrogates manually, size `out`
// up front — while keeping byte-for-byte parity with the baseline.
pub fn candidate_utf16_to_utf8(input: &[u16], out: &mut Vec<u8>) -> Result<(), String> {
    out.clear();
    for unit in char::decode_utf16(input.iter().copied()) {
        match unit {
            Ok(c) => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
            Err(_) => return Err("invalid utf-16".into()),
        }
    }
    Ok(())
}
