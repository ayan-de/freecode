// CANDIDATE — edit only this file.
//
// Contract:
//   - Input: any f32 (including NaN, ±0, ±inf, subnormals)
//   - Output: a String that, when parsed back via f32::from_str, yields the EXACT
//     same bit pattern as the input. This is the round-trip property.
//   - The output must be the SHORTEST such string (jcode bench requires shortest
//     round-trip; without that constraint, "1.0" and "1.00" both round-trip).
//
// Start naive, then optimize. Run `cargo test -p jcode-bench` to check correctness,
// `cargo bench --bench float_print` to measure speed.
use std::fmt::Write;

pub fn candidate_f32_to_string(f: f32, out: &mut String) {
    // TODO: replace this with a Grisu/Ryu-class algorithm.
    let _ = write!(out, "{}", f);
}