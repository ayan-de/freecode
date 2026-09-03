"use client";

import { useState } from "react";

export interface BenchBar {
  label: string;
  /** Bar length is this over the row set's max. */
  value: number;
  display: string;
  note: string;
  highlight?: boolean;
}

/**
 * The horizontal bar list used by every chart on this page — the same shape
 * Benchmark.tsx draws for the runtime numbers, so the two pages read as one
 * site. Colour comes only from theme tokens, so it follows the toggle.
 */
export function BenchBarList({
  id,
  title,
  description,
  bars,
  footnote,
}: {
  id: string;
  title: string;
  description: string;
  bars: BenchBar[];
  footnote?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;

  return (
    <div className="rounded-md border border-border bg-card p-6 md:p-8">
      <div className="mb-6">
        <h3 className="text-lg font-medium text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="space-y-4">
        {bars.map((bar) => {
          const key = `${id}-${bar.label}`;
          return (
            <div
              key={key}
              className="group relative flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-border hover:bg-accent/10 px-2 rounded transition-colors"
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="w-full md:w-36 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                <span
                  className={`font-mono text-sm ${bar.highlight ? "text-primary font-bold" : "text-foreground/70"}`}
                >
                  {bar.label}
                </span>
                <span className="md:hidden text-xs text-muted-foreground/60">
                  {bar.display}
                </span>
              </div>

              <div className="flex-1 mx-0 md:mx-6 flex items-center relative h-6">
                <div className="w-full bg-muted h-3.5 rounded overflow-hidden border border-border">
                  <div
                    className={`h-full transition-all duration-1000 ease-out ${
                      bar.highlight
                        ? "bg-primary shadow-[0_0_12px_var(--primary)]"
                        : "bg-foreground/25 group-hover:bg-foreground/40"
                    }`}
                    style={{ width: `${(bar.value / max) * 100}%` }}
                  />
                </div>

                {hovered === key && (
                  <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 bg-popover border border-border rounded px-2.5 py-1 text-xs text-popover-foreground font-mono shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                    <span className="font-bold text-primary">{bar.display}</span>
                    <span className="text-muted-foreground/45">|</span>
                    <span>{bar.note}</span>
                  </div>
                )}
              </div>

              <div className="hidden md:flex w-56 justify-between items-center text-right font-mono text-xs">
                <span
                  className={`text-sm ${bar.highlight ? "text-primary font-semibold" : "text-foreground/90"}`}
                >
                  {bar.display}
                </span>
                <span className="text-muted-foreground/60 text-[10px] w-32">
                  {bar.note}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {footnote && (
        <div className="mt-6 p-4 rounded bg-muted border border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {footnote}
          </p>
        </div>
      )}
    </div>
  );
}
