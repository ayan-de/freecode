#!/usr/bin/env bash
# Run cargo test (correctness gate) for every task, then compute scores.
# Writes results.json into bench/jcode-bench/ and prints a Markdown table.
#
# Usage: scripts/score_freecode_bench.sh [task-name...]

set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../bench/jcode-bench" && pwd)"
cd "$BENCH_DIR"

if [[ $# -gt 0 ]]; then
  TASKS=("$@")
else
  TASKS=(float-print json-unescape utf16-transcode)
fi

echo "[bench] running correctness gate (cargo test)" >&2
# Each task's tests live in a dedicated integration-test binary named after the
# bench (hyphens -> underscores). `cargo test -- <task>` would filter by test-fn
# NAME and match nothing, silently passing — use --test to run the real gate.
for task in "${TASKS[@]}"; do
  bin="${task//-/_}"
  echo "[bench]   gate: $task (--test $bin)" >&2
  if ! cargo test --release -p jcode-bench --test "$bin"; then
    echo "[bench] correctness gate FAILED for $task — fix candidate.rs and re-run" >&2
    exit 1
  fi
done

echo "[bench] computing scores" >&2
cargo run --release --bin score -- "${TASKS[@]}"

# Pretty-print results.json, then (on a full 3-task run) sync the numbers into
# the JSON the website imports — preserving `published` + the jcode reference
# rows. Model label comes from $FREECODE_BENCH_MODEL, else $FREECODE_MODEL.
WEB_JSON="$(cd "$BENCH_DIR/../.." && pwd)/apps/web/app/data/freecode-bench-results.json"
BENCH_MODEL="${FREECODE_BENCH_MODEL:-${FREECODE_MODEL:-}}"
BENCH_DIR="$BENCH_DIR" WEB_JSON="$WEB_JSON" BENCH_MODEL="$BENCH_MODEL" python3 - <<'PY'
import json, os, datetime

d = json.load(open(os.path.join(os.environ["BENCH_DIR"], "results.json")))

print("\n## Scores")
print("| Task | Score (log2) |")
print("| --- | --- |")
for k, v in d.get("tasks", {}).items():
    print(f"| {k} | {v['score']:+.2f} |")
if d.get("geomean") is not None:
    print(f"| **geomean** | **{d['geomean']:+.2f}** (≈ {d['typical_speedup_x']:.1f}×) |")

# Sync to the website only on a full run (geomean present). A partial run must
# not overwrite the published leaderboard with an incomplete row.
web_path = os.environ["WEB_JSON"]
if "geomean" not in d:
    print("\n[bench] partial run — website JSON NOT updated (need all 3 tasks for a geomean).")
elif not os.path.exists(web_path):
    print(f"\n[bench] web JSON not found at {web_path} — skipped sync.")
else:
    web = json.load(open(web_path))
    web["_comment"] = ("Auto-synced by scripts/score_freecode_bench.sh on a full 3-task run. "
                       "Set `published: true` to render on the site. `_jcode_reference` rows are preserved.")
    web["generated_at"] = datetime.date.today().isoformat()
    model = os.environ.get("BENCH_MODEL", "").strip()
    if model:
        web["model"] = model
    web["tasks"] = {
        k: {"bench": v.get("bench", k.replace("-", "_")),
            "score": round(v["score"], 4),
            "speedup_x": round(2 ** v["score"], 3)}
        for k, v in d["tasks"].items()
    }
    web["scores"] = [round(s, 4) for s in d["scores"]]
    web["geomean"] = round(d["geomean"], 4)
    web["typical_speedup_x"] = round(d["typical_speedup_x"], 3)
    web.pop("_placeholder_note", None)
    open(web_path, "w").write(json.dumps(web, indent=2) + "\n")
    pub = web.get("published", False)
    print(f"\n[bench] synced -> {web_path}")
    print(f"[bench] model={web.get('model')!r}  published={pub}"
          + ("" if pub else "  (set published:true to show it on the site)"))
PY