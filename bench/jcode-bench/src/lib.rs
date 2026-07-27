// jcode-bench: shared library code.
//
// Each task lives in `tasks/<name>/` with:
//   baseline.rs  — naive reference implementation (fixed, agent cannot edit)
//   candidate.rs — the function the agent optimizes
//   tests.rs     — correctness gate (cargo test must pass)
//
// Bench harness in `benches/` compares baseline vs candidate via criterion.

/// Combined score = geometric mean of the per-task log2(speedup) scores (jcode
/// methodology, so one high-headroom task can't dominate). Geometric mean needs
/// positive inputs; a task the agent did not speed up (speedup <= 1x, score <= 0)
/// contributes no headroom, so we floor it at 0. `0f64.ln()` is `-inf`, which
/// makes the whole geomean collapse to 0 — you must beat *every* task to score.
/// (Without the floor, a negative score yields `ln(neg) = NaN`.)
pub fn geomean(scores: &[f64]) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }
    let mean_log: f64 = scores.iter().map(|s| s.max(0.0).ln()).sum::<f64>() / scores.len() as f64;
    mean_log.exp()
}