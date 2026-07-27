#!/usr/bin/env bash
# Run FreeCode on one FreeCode bench v1 task.
#
# Usage:
#   scripts/run_freecode_bench.sh <task-name>            # one task
#   FREECODE_BIN=path/to/freecode scripts/run_freecode_bench.sh float-print
#   scripts/run_freecode_bench.sh float-print --timeout 600
#
# After the agent finishes, candidate.rs has the agent's submission. Then run:
#   scripts/score_freecode_bench.sh <task-name>
# to compute log2(speedup) and append to results.json.
#
# Inspired by jcode's "jcode bench v1" (https://jcode.sh/bench) — same three
# tasks, same scoring, same exhaustive correctness gates.

set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../bench/jcode-bench" && pwd)"
TASK="${1:?usage: run_freecode_bench.sh <task-name>  # float-print|json-unescape|utf16-transcode}"
shift || true

case "$TASK" in
  float-print|json-unescape|utf16-transcode) ;;
  *) echo "unknown task: $TASK" >&2; exit 2 ;;
esac

FREECODE_BIN="${FREECODE_BIN:-node "$BENCH_DIR/../../apps/core/dist/cli.js"}"
MODEL="${FREECODE_MODEL:-}"
PROMPT_FILE="$BENCH_DIR/tasks/$TASK/PROMPT.md"

# Per-task prompt — points the agent at the right files and pins the contract.
cat > "$PROMPT_FILE" <<EOF
You are running a coding-agent benchmark. There is exactly one task:

TASK: $TASK
REPO: $BENCH_DIR

WHAT TO DO
1. Read the spec in $BENCH_DIR/docs/freecode-bench-spec.md (the scoring rules
   and the round-trip correctness gate are non-negotiable).
2. The baseline (do NOT modify) is in
   $BENCH_DIR/tasks/$TASK/baseline.rs.
3. The candidate (you edit ONLY this) is in
   $BENCH_DIR/tasks/$TASK/candidate.rs.
4. Edit candidate.rs to implement the primitive. Match the signature exactly.
5. From $BENCH_DIR, run:
     cargo test --release -p jcode-bench --test $(echo "$TASK" | tr '-' '_')
   If any test fails, fix the candidate and re-run. Correctness gates the score
   — a fast-but-wrong answer scores zero.
6. Then run:
     cargo bench --bench $(echo "$TASK" | tr '-' '_') -- --noplot
   Record the median ns for both baseline and candidate.
7. Iterate (measure → optimize → re-test) until you stop improving meaningfully.
   Do not modify baseline.rs. Do not add dependencies to Cargo.toml without a
   strong reason.
8. When done, save the final candidate.rs to
   $BENCH_DIR/tasks/$TASK/candidate.rs and write a one-paragraph summary
   (technique used, expected score) to
   $BENCH_DIR/tasks/$TASK/SUMMARY.md.

OUTPUT
Use shell, edit, and bench tools. Do not produce narrative — be terse, push
files, run commands. When correctness + bench pass and you stop improving,
say "DONE" and exit.

CONSTRAINTS
- Correctness gate is exact 2^32 round-trip for float-print, full UTF-8
  correctness for utf16-transcode, and a randomized 1000-trial corpus match
  for json-unescape. Failing any one of those = 0 score.
- Score = log2(baseline_ns / candidate_ns). Combined with the other two tasks
  via geometric mean.
EOF

ARGS=("--message" "$(cat "$PROMPT_FILE")" "--agent" "danger")
if [[ -n "$MODEL" ]]; then
  ARGS+=("--model" "$MODEL")
fi
ARGS+=("$@")

echo "[bench] running FreeCode on task=$TASK (mode=danger)" >&2
# The agent's prompt tells it to cd into $BENCH_DIR for cargo. We launch
# `freecode run` from the repo root so the daemon's working dir is sane.
REPO_ROOT="$(cd "$BENCH_DIR/../.." && pwd)"
cd "$REPO_ROOT"
$FREECODE_BIN run "${ARGS[@]}"