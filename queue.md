# Experiment queue — 2026-09-04

Spec: `docs/superpowers/specs/2026-09-04-harness-cost-efficiency.md`

## 1. D3 coding A/B — ✅ DONE (2026-09-04)
```
pnpm eval ab coding --baseline env:FREECODE_READ_LINE_NUMBERS=1 \
  --candidate env:FREECODE_READ_LINE_NUMBERS=0 --trials 3 \
  --out <scratchpad>/d3-coding-ab.json
```

**Result:** all 11 coding cases passed 3/3 on both sides — line numbers off
loses nothing on correctness — while turning them off was cheaper across the
board (MiniMax-M3 both sides, at 23bf8ce):

| Metric        | Line numbers ON | Line numbers OFF | Δ        |
| ------------- | --------------- | ---------------- | -------- |
| Tokens        | 1,317,158       | 1,174,060        | −10.9%   |
| Cost          | $0.1566         | $0.1200          | −23.4%   |
| Turns         | 152             | 139              | −13      |
| Repeated calls| 5               | 2                | −3       |

One model, coding suite only — run #2 (judged) before flipping the default.

## 2. D3 judged A/B — ✅ DONE (2026-09-04)
Same shape, suite `judged`. Judge env (minimax is under test, so judge = gemini):
```
FREECODE_JUDGE_PROVIDER=gemini FREECODE_JUDGE_MODEL=gemini-3.5-flash-lite
```

**Result:** all 6 judged cases passed 3/3 on both sides — no blackout, every
case scored (MiniMax-M3 both sides, at 6fa99f2). Citation quality survives
the prefix removal, and OFF is again cheaper:

| Metric        | Line numbers ON | Line numbers OFF | Δ        |
| ------------- | --------------- | ---------------- | -------- |
| Tokens        | 518,409         | 482,906          | −6.8%    |
| Cost          | $0.0662         | $0.0536          | −18.9%   |
| Turns         | 30              | 29               | −1       |
| Repeated calls| 0               | 0                | =        |

Both risk axes from the spec (file:line citations, edit disambiguation) are
now answered. **Default FLIPPED 2026-09-04**: prefixes off in `read.ts`,
`FREECODE_READ_LINE_NUMBERS=1` restores. Docs/spec/env reference updated.

## 3. D2 re-run (cost delta) — ✅ DONE (2026-09-04) — NEGATIVE
First D2 run predates 87b0e2d, so it has pass counts but no tokens/cost.
```
pnpm eval ab coding --baseline env:FREECODE_BASH_COMPRESS=0 \
  --candidate env:FREECODE_BASH_COMPRESS=1 --trials 3
```

**Result:** all 11 cases pass 3/3 both sides, but compression ON is WORSE
(MiniMax-M3 both sides, at 6fa99f2) — the recovery-detour pattern:

| Metric        | Compress OFF | Compress ON | Δ        |
| ------------- | ------------ | ----------- | -------- |
| Tokens        | 1,234,164    | 1,381,547   | +11.9%   |
| Cost          | $0.1363      | $0.1512     | +10.9%   |
| Turns         | 145          | 160         | +15      |
| Repeated calls| 3            | 4           | +1       |

**Verdict: D2's default stays OFF.** The flag and code stay for a future
retry (different classifier thresholds or a model that pages via `output`
more willingly), but this workload doesn't earn it.

## 4. D4 prompt compression — ✅ DONE (2026-09-04), GATE OPEN ×3
1. ✅ Guard validated: `parallel-batch-two-reads` passed on every run (4 single
   runs + the 3-trial gate). It also caught a real regression: compression v1
   dropped "requesting input is a blocking action", and the model burned a
   turn asking a rejected `question` in explore mode (`explore-mode-stays-
   readonly` failed 2/2 on v1, passed on the original — control via git
   stash). v2 restored the rule; case green ever since.
2. ✅ Compressed: `system.md` 8,862 → 5,446 chars (−38.5%); descriptions for
   grep/bash/memory/todowrite/agent roughly halved. Bash's description also
   lost its stale "read numbers the lines" claim (D3 flip).
3. ✅ `eval:gate` (judge gemini-3.5-flash-lite): trajectory GATE OPEN,
   coding GATE OPEN, judged GATE OPEN — mean 4.83/5, no case below 4.
   Only failure anywhere: quarantined `review-mode-readonly` timeout.
4. ✅ Reviewed — safe to commit. (Uncommitted; commit alongside D3's flip.)

## Parked
- Repeated "prompt-cache miss: cached prefix re-written (~13K tokens)" warnings
  seen in D2 coding trials — possible cache-invalidation bug, chase separately.
  Recurred in D3 (~10 warnings, 128–8,832 tok each), so it's reproducible.
