# FreeCode bench v1 — spec & rules

> **What is this?** This directory contains a clean-room reproduction of jcode's
> "jcode bench v1" — the "optimization-depth" benchmark they publish at
> <https://jcode.sh/bench>, with their model comparison at
> <https://jcode.sh/models>. The harness below follows the same methodology —
> naive baseline, exhaustive correctness gate, `log2(speedup)` scoring, geometric
> mean across tasks — and runs FreeCode through it so we can publish a
> transparent, like-for-like number against jcode's table. We name it FreeCode
> bench v1 because the methodology is ours to defend and we want readers to know
> what they're looking at; jcode's numbers are still included as context rows.

## Three tasks

| Task              | Primitive                          | Baseline                    |
| ----------------- | ---------------------------------- | --------------------------- |
| `float-print`     | shortest round-trip `f32 → string` | `f.to_string()`             |
| `json-unescape`   | unescape JSON string contents      | byte-by-byte `\uXXXX` loop  |
| `utf16-transcode` | UTF-16 LE → UTF-8                  | `char::decode_utf16` loop   |

Each task lives in `tasks/<name>/` with three files:
- `baseline.rs` — naive reference implementation, **do not edit**
- `candidate.rs` — the function the agent optimizes
- `tests.rs` — correctness gate (`cargo test` must pass)

## Correctness gate

- **float-print**: every u32 bit pattern must round-trip exactly (parse(candidate(bits)) == bits), and the candidate must not be longer than Rust's shortest-round-trip output. Sampled every 1/1024 in CI; full 2³² sweep on release.
- **json-unescape**: must match the baseline byte-for-byte on a corpus of valid inputs, AND must reject the same set of invalid inputs (lone surrogates, bad `\u` sequences, unknown escapes).
- **utf16-transcode**: must match `String::from_utf16` on a randomized corpus, plus hand-picked supplementary-plane and invalid-surrogate cases.

Failing any test → `score = 0` for that task. Speed is meaningless without correctness.

## Cost model (timing)

- Hardware: whatever the runner is on. jcode publishes numbers without pinning hardware; we do the same — record the CPU model in `results.json` before publishing.
- `cargo bench` via Criterion, 100 samples, default warmup. Median ns/op reported.
- `score = log2(baseline_ns / candidate_ns)`. Doublings of speed, not raw ns.

## Aggregation

```
combined_score = exp(mean(log(score_task) for task in tasks))
```

Same geometric mean as jcode's table — prevents one high-headroom task dominating.

## How to run

```bash
# 1. Run FreeCode on one task
scripts/run_freecode_bench.sh float-print

# 2. After the agent finishes, run the correctness gate + score
scripts/score_freecode_bench.sh

# Or pick one task
scripts/score_freecode_bench.sh json-unescape
```

The score CLI writes `results.json` and prints a Markdown table. Append the row to your model comparison table.

## Fairness rules

1. **Same model.** jcode published Opus 4.8, Fable 5, GPT-5.x, Sonnet 5 rows. Run FreeCode on the *same* model + reasoning effort to make the delta reflect the agent, not the model.
2. **Same prompt for every model.** The per-task prompt lives in `tasks/<name>/PROMPT.md` and is regenerated identically each run.
3. **Published transcripts.** Keep `tasks/<name>/candidate.rs` and the SUMMARY.md as the artifact. jcode's pitch is "no hidden test sets" — match that.
4. **Honest cost model.** If hardware differs from jcode's, say so in the table footnote. Numbers won't match bit-for-bit across machines but the relative ordering (and a `+X vs jcode +Y` delta) is the point.