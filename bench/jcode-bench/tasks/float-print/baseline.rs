// BASELINE — naive float-to-string. Agent must not edit this file.
// Score = log2(baseline_ns / candidate_ns). Correctness gate below.

pub fn baseline_f32_to_string(f: f32) -> String {
    f.to_string()
}