# Memory recall benchmark

Spec: `docs/superpowers/specs/2026-08-23-memory-consolidation.md` D14.

```bash
pnpm bench:recall              # metrics table
pnpm bench:recall -- --verbose # + per-query breakdown
pnpm bench:recall -- --json    # raw numbers, for diffing two runs
```

Loads `corpus/` into a throwaway `MemoryStore`, runs every query through the
**production** `MemoryGraphService.retrieve()`, and scores the ranked ids. It
calls the real service on purpose: a benchmark of a reimplementation measures
the reimplementation.

## Reading the output

The `mode` column says which retrieval path produced the numbers. `fastembed`
is an optional dependency, so a machine without it benchmarks the **lexical
path alone** and prints a warning — those numbers are not comparable with a
`fused` run. Run `pnpm install` at the repo root before trusting a baseline.

`abstention accuracy` is the fraction of queries with no relevant memory that
correctly returned nothing. It is the number defect 3 shows up as.

## Baseline — 2026-08-23, before any Phase 1 change

Retrieval as shipped: vector seeds with a keyword fallback that fires whenever
the vector store returns nothing, plus a terminal fallback in `retrieve()`.

| metric | fused | lexical_only |
| --- | ---: | ---: |
| recall@5 | 77.3% | 61.4% |
| recall@10 | 86.4% | 72.7% |
| precision@5 | 22.7% | 18.2% |
| MRR | 87.1% | 51.8% |
| nDCG@10 | 80.5% | 53.6% |
| **abstention accuracy** | **0.0%** | **20.0%** |

22 scored queries, 5 abstention queries, 0 model calls.

Retrieval on real queries is good. Abstention is total failure: all five
off-topic queries — including `what is 2 + 2` and `what is the capital of
Portugal` — return the full 10 memories. That is the entire justification for
D1, and it is why the fused row scores *worse* on abstention than the
lexical-only row: the more retrievers that fall back, the more certain the leak.

`precision@5` is low in absolute terms because most queries have one or two gold
documents and the metric divides by k. Read it as a relative measure between
runs, not as an absolute quality score.

## Corpus

`corpus/memories.json` — 40 memories over the four types, including three
near-duplicate pairs and two superseded records, which exist for the Phase 5
consolidation tests.

`corpus/queries.json` — 27 queries. Five have `relevant: []`; those are the
abstention cases and are scored separately, because recall and nDCG are
undefined when nothing is relevant.

Both files are hand-written and committed. Adding a query means adding its gold
labels; `validateCorpus()` fails the run if a gold id names a memory that does
not exist, since that silently caps recall and reads as a retrieval bug.

**Bias warning:** this corpus was written by the same people who wrote the
retriever. It catches regressions well and proves little about absolute quality.
LongMemEval-S (spec D14) is the external corpus and is not yet wired up.
