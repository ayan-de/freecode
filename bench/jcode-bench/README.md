# jcode-bench

The optimisation-task harness: jcode bench v1's tasks, unmodified, climbed by
any agent with an adapter in `agents/`, graded by the upstream `./grade`,
published to `/bench`.

**Operator reference is `HARNESS-BENCH.md` at the repo root** (§2). Design
in `docs/superpowers/specs/2026-09-12-harness-bench.md`.

```bash
pnpm bench:jcode --tasks utf16-transcode --agents freecode --trials 1   # needs valgrind
pnpm test:jcode-bench                                                   # free
```

Imports agent-bench's adapters, spawn code and recording proxy by relative
path; do not duplicate them here.
