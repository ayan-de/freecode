You are running a coding-agent benchmark. There is exactly one task:

TASK: json-unescape
REPO: /home/ayan-de/Projects/freecode/bench/jcode-bench

WHAT TO DO
1. Read the spec in /home/ayan-de/Projects/freecode/bench/jcode-bench/docs/freecode-bench-spec.md (the scoring rules
   and the round-trip correctness gate are non-negotiable).
2. The baseline (do NOT modify) is in
   /home/ayan-de/Projects/freecode/bench/jcode-bench/tasks/json-unescape/baseline.rs.
3. The candidate (you edit ONLY this) is in
   /home/ayan-de/Projects/freecode/bench/jcode-bench/tasks/json-unescape/candidate.rs.
4. Edit candidate.rs to implement the primitive. Match the signature exactly.
5. From /home/ayan-de/Projects/freecode/bench/jcode-bench, run:
     cargo test --release -p jcode-bench --test json_unescape
   If any test fails, fix the candidate and re-run. Correctness gates the score
   — a fast-but-wrong answer scores zero.
6. Then run:
     cargo bench --bench json_unescape -- --noplot
   Record the median ns for both baseline and candidate.
7. Iterate (measure → optimize → re-test) until you stop improving meaningfully.
   Do not modify baseline.rs. Do not add dependencies to Cargo.toml without a
   strong reason.
8. When done, save the final candidate.rs to
   /home/ayan-de/Projects/freecode/bench/jcode-bench/tasks/json-unescape/candidate.rs and write a one-paragraph summary
   (technique used, expected score) to
   /home/ayan-de/Projects/freecode/bench/jcode-bench/tasks/json-unescape/SUMMARY.md.

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
