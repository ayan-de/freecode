"use client";

import { freecodeBenchSection } from "../data/benchmark";

// FreeCode bench v1 — frontier-model comparison.
// Inspired by jcode's "jcode bench v1" (https://jcode.sh/models). Same three
// optimization-depth tasks, same scoring (log2 speedup, geometric mean across
// tasks). FreeCode row pinned at top, jcode's published frontier rows beneath
// for context. Hidden when results.json has `published: false`.

export function FreeCodeBench() {
  const data = freecodeBenchSection;
  if (!data) return null;

  return (
    <section id="freecode-bench" className="w-full max-w-4xl mx-auto pt-4 pb-12">
      <p className="text-lg lg:text-xl text-muted-foreground text-left mb-4 max-w-2xl">
        FreeCode bench measures <em>optimization depth</em>: how many times
        faster can a coding agent make a primitive, while staying correct on
        every input. Higher is better; combined score is the geometric mean
        across the three tasks.
      </p>

      <div className="rounded-md border border-border bg-card p-6 md:p-8">
        <div className="flex items-start gap-4 mb-6">
          <div>
            <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
              FreeCode bench v1 — frontier model comparison
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Methodology adapted from{" "}
              <a href="https://jcode.sh/bench" className="underline">
                jcode.sh/bench
              </a>
              . Generated {data.generatedAt} on {data.hardware}.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Model</th>
                <th className="py-2 px-2 text-right font-medium">json-unescape</th>
                <th className="py-2 px-2 text-right font-medium">float-print</th>
                <th className="py-2 px-2 text-right font-medium">utf16-transcode</th>
                <th className="py-2 px-2 text-right font-medium">Geomean</th>
                <th className="py-2 pl-2 text-right font-medium">Speedup</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={r.model}
                  className={
                    r.isFreeCode
                      ? "border-b border-border bg-primary/5"
                      : "border-b border-border/50"
                  }
                >
                  <td className="py-2 pr-4">
                    <span
                      className={
                        r.isFreeCode
                          ? "text-primary font-bold"
                          : "text-foreground/80"
                      }
                    >
                      {r.model}
                    </span>
                  </td>
                  <td className={`py-2 px-2 text-right ${r.isFreeCode ? "text-primary font-semibold" : ""}`}>+{r.jsonUnescape.toFixed(2)}</td>
                  <td className={`py-2 px-2 text-right ${r.isFreeCode ? "text-primary font-semibold" : ""}`}>+{r.floatPrint.toFixed(2)}</td>
                  <td className={`py-2 px-2 text-right ${r.isFreeCode ? "text-primary font-semibold" : ""}`}>+{r.utf16Transcode.toFixed(2)}</td>
                  <td className={`py-2 px-2 text-right font-bold ${r.isFreeCode ? "text-primary" : "text-foreground"}`}>+{r.geomean.toFixed(2)}</td>
                  <td className={`py-2 pl-2 text-right ${r.isFreeCode ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                    {r.typicalSpeedupX.toFixed(1)}×
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground/70 mt-6 leading-relaxed">
          Score is <code className="text-foreground/80">log2(speedup)</code>{" "}
          under each task's published cost model; correctness is an exact gate
          (exhaustive 2³² round-trip for float-print, full UTF-8 for
          utf16-transcode, randomized corpus for json-unescape). Rows below
          FreeCode are jcode&apos;s published numbers, included for context. To
          reproduce:{" "}
          <code className="text-foreground/80">
            scripts/run_freecode_bench.sh &lt;task&gt;
          </code>{" "}
          then{" "}
          <code className="text-foreground/80">
            scripts/score_freecode_bench.sh
          </code>
          .
        </p>
      </div>
    </section>
  );
}