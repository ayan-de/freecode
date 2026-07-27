// Score CLI.
//
// Usage:
//   cargo run --release --bin score -- float-print
//   cargo run --release --bin score -- all        # geomean across the 3 tasks
//
// For each task:
//   1. Runs `cargo bench --bench <name>` and parses criterion's median ns/op
//      for `baseline` and `candidate` (from target/criterion/<bench>/.../estimates.json).
//   2. Computes score = log2(baseline_ns / candidate_ns).
//   3. Writes results.json.
//
// Geomean matches jcode bench v1: typical doublings per task.

use jcode_bench::geomean;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const TASKS: &[(&str, &str)] = &[
    ("float-print", "float_print"),
    ("json-unescape", "json_unescape"),
    ("utf16-transcode", "utf16_transcode"),
];

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_median_ns(bench_dir: &Path) -> Option<f64> {
    // criterion writes target/criterion/<group>/<fn>/base/estimates.json
    // — point estimate under "median" (in nanoseconds).
    let s = fs::read_to_string(bench_dir.join("base").join("estimates.json")).ok()?;
    let v: Value = serde_json::from_str(&s).ok()?;
    v.get("median")
        .and_then(|m| m.get("point_estimate"))
        .and_then(|p| p.as_f64())
}

fn find_criterion_estimates(bench_name: &str, group: &str) -> Option<f64> {
    // criterion writes target/criterion/<bench>_<group>/base/estimates.json
    // (underscore-joined; see `find target/criterion -name estimates.json`)
    let dir = format!("{}_{}", bench_name, group);
    let path = project_root().join("target").join("criterion").join(dir);
    read_median_ns(&path)
}

fn run_bench(bench_bin: &str) {
    eprintln!("[score] running cargo bench --bench {}", bench_bin);
    let status = Command::new("cargo")
        .args(["bench", "--bench", bench_bin, "--", "--noplot"])
        .current_dir(project_root())
        .status()
        .expect("failed to spawn cargo");
    assert!(status.success(), "cargo bench {} failed", bench_bin);
}

fn score_task(name: &str, bench_bin: &str) -> f64 {
    run_bench(bench_bin);
    let baseline_ns = find_criterion_estimates(bench_bin, "baseline")
        .expect("baseline median not found — was the bench run?");
    let candidate_ns = find_criterion_estimates(bench_bin, "candidate")
        .expect("candidate median not found — was the bench run?");
    let score = (baseline_ns / candidate_ns).log2();
    eprintln!(
        "[score] {name}: baseline={:.1}ns candidate={:.1}ns score={:+.2}",
        baseline_ns, candidate_ns, score
    );
    score
}

fn main() {
    // Accept a list of tasks (e.g. `score float-print json-unescape`), or "all"
    // / no args for the full suite. nth(1) alone would silently drop every task
    // after the first and never reach the geomean branch.
    let args: Vec<String> = std::env::args().skip(1).collect();
    let all = args.is_empty() || args.iter().any(|a| a == "all");

    let mut results = serde_json::Map::new();
    let mut scores = Vec::new();

    let selected: Vec<&(&str, &str)> = TASKS
        .iter()
        .filter(|t| all || args.iter().any(|a| a == t.0 || a == t.1))
        .collect();

    for (name, bench_bin) in &selected {
        let s = score_task(name, bench_bin);
        scores.push(s);
        results.insert(
            (*name).to_string(),
            json!({ "score": s, "bench": bench_bin }),
        );
    }

    let summary = if selected.len() == TASKS.len() {
        let gm = geomean(&scores);
        json!({
            "tasks": results,
            "scores": scores,
            "geomean": gm,
            "typical_speedup_x": 2f64.powf(gm),
        })
    } else {
        json!({ "tasks": results, "scores": scores })
    };

    let out = project_root().join("results.json");
    fs::write(&out, serde_json::to_string_pretty(&summary).unwrap()).unwrap();
    eprintln!("[score] wrote {}", out.display());
    println!("{}", serde_json::to_string_pretty(&summary).unwrap());
}