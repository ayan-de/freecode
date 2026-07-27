"use client";

import { useState } from "react";
import benchmark from "../data/tool-token-benchmark.json";

interface ToolRow {
  label: string;
  verified: boolean;
  hasRetrieval: boolean;
  source: string;
  totalTokens: number;
}

// Sorted ascending (best first) by the bench script; lower tokens = better.
const tools = benchmark.tools as ToolRow[];
const best = Math.min(...tools.map((t) => t.totalTokens));
const worst = Math.max(...tools.map((t) => t.totalTokens));

function isFreeCode(label: string): boolean {
  return label.startsWith("freecode (new)");
}

export function TokenBenchmark() {
  const [hoveredIndex, setHoveredIndex] = useState<string | null>(null);

  return (
    <section id="token-benchmark" className="w-full max-w-4xl mx-auto pt-4 pb-12">
      <p className="text-lg lg:text-xl text-muted-foreground text-left mb-12 max-w-2xl">
        Tokens are the bill. On a large tool output whose answer is in the tail — a
        build error at the end, the last grep matches — FreeCode injects the fewest
        tokens, capturing the full output once and letting the model page the rest
        instead of re-running the command.
      </p>

      <div className="rounded-md border border-border bg-card p-6 md:p-8">
        <div className="flex items-start gap-4 mb-6">
          <div>
            <h3 className="text-lg font-medium text-foreground">
              Model-input tokens per large-output turn
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Lower is better. Tokens each tool&rsquo;s harness sends the model to get
              head&nbsp;+&nbsp;tail of an oversized output. Modeled from each
              tool&rsquo;s truncation policy in its own source — not a live API run.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {tools.map((item) => {
            const fc = isFreeCode(item.label);
            const widthPct = (item.totalTokens / worst) * 100;
            const isHovered = hoveredIndex === item.label;
            const delta =
              item.totalTokens === best
                ? "best"
                : `+${Math.round(((item.totalTokens - best) / best) * 100)}%`;
            return (
              <div
                key={item.label}
                className="group relative flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-border hover:bg-accent/10 px-2 rounded transition-colors"
                onMouseEnter={() => setHoveredIndex(item.label)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div className="w-full md:w-40 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                  <span
                    className={`font-mono text-sm ${
                      fc ? "text-primary font-bold" : "text-foreground/70"
                    }`}
                  >
                    {item.label}
                    {!item.verified && (
                      <span className="text-muted-foreground/50" title="policy not confirmed from source">
                        {" "}*
                      </span>
                    )}
                  </span>
                  <span className="md:hidden text-xs text-muted-foreground/60">
                    {item.totalTokens.toLocaleString()}
                  </span>
                </div>

                <div className="flex-1 mx-0 md:mx-6 flex items-center relative h-6">
                  <div className="w-full bg-muted h-3.5 rounded overflow-hidden border border-border">
                    <div
                      className={`h-full transition-all duration-1000 ease-out ${
                        fc
                          ? "bg-primary shadow-[0_0_12px_var(--primary)]"
                          : "bg-[#c2c0b4] dark:bg-[#b8b5a8] group-hover:bg-[#d8d6cc]"
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>

                  {isHovered && (
                    <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 bg-popover border border-border rounded px-2.5 py-1 text-xs text-popover-foreground font-mono shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                      <span className="font-bold text-primary">
                        {item.totalTokens.toLocaleString()} tok
                      </span>
                      <span className="text-muted-foreground/45">|</span>
                      <span>{item.hasRetrieval ? "retrieval" : "re-run"}</span>
                    </div>
                  )}
                </div>

                <div className="hidden md:flex w-48 justify-between items-center text-right font-mono text-xs">
                  <span
                    className={`text-sm ${
                      fc ? "text-primary font-semibold" : "text-foreground/90"
                    }`}
                  >
                    {item.totalTokens.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground/60 text-[10px] w-24">
                    {delta} · {item.hasRetrieval ? "retrieval" : "re-run"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Honesty note — this is a modeled comparison, not a live measurement. */}
        <div className="flex items-start gap-2.5 mt-6 p-4 rounded bg-muted border border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="text-foreground/80 font-medium">How to read this:</span>{" "}
            FreeCode&rsquo;s lead is a tighter first-turn cap (30&nbsp;KB vs
            opencode/pi&rsquo;s 50&nbsp;KB) plus an in-memory output store — frugal by
            design, not strictly more capable. opencode and pi also have retrieval
            (file-based), so they avoid the re-run penalty that the head-only tools pay.
            <span className="text-muted-foreground/70">
              {" "}
              Rows marked <span className="font-mono">*</span> are unverified from
              source. Modeled, deterministic, no API calls.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
