"use client";

import { useState } from "react";
import {
  memory1SessionData,
  timeToReadyData,
  memory10SessionsData,
} from "../data/benchmark";

export function Benchmark() {
  const [hoveredIndex, setHoveredIndex] = useState<string | null>(null);

  // Maximum values for normalization
  const maxMemory1 = Math.max(...memory1SessionData.map(d => d.value || 0));
  const maxTime = Math.max(...timeToReadyData.map(d => d.value || 0));
  const maxMemory10 = Math.max(...memory10SessionsData.map(d => d.value || 0));

  return (
    <section id="benchmark" className="w-full max-w-4xl mx-auto pt-4 pb-12">
      <p className="text-lg lg:text-xl text-muted-foreground text-left mb-12 max-w-2xl">
        Swarms only push intelligence if they scale, and they only scale if each agent costs almost nothing. FreeCode is optimized to the bone so agents stay cheap to spawn, with none of it traded for speed.
      </p>

      <div className="flex flex-col gap-12">
        {/* Chart 1: Memory Footprint (1 session) */}
        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <div className="flex items-start gap-4 mb-6">
            <div>
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                Memory footprint (PSS, MB)
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Resident memory of the entire process tree (tool + all descendants + process group), summed across process descendants.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {memory1SessionData.map((item) => {
              const widthPct = ((item.value || 0) / maxMemory1) * 100;
              const isHovered = hoveredIndex === `mem1-${item.tool}`;
              return (
                <div
                  key={item.tool}
                  className="group relative flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-border hover:bg-accent/10 px-2 rounded transition-colors"
                  onMouseEnter={() => setHoveredIndex(`mem1-${item.tool}`)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="w-full md:w-32 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                    <span className={`font-mono text-sm ${item.isFreeCode ? "text-primary font-bold animate-pulse" : "text-foreground/70"}`}>
                      {item.tool}
                    </span>
                    <span className="md:hidden text-xs text-muted-foreground/60">{item.displayValue}</span>
                  </div>

                  <div className="flex-1 mx-0 md:mx-6 flex items-center relative h-6">
                    <div className="w-full bg-muted h-3.5 rounded overflow-hidden border border-border">
                      <div
                        className={`h-full transition-all duration-1000 ease-out ${
                          item.isFreeCode
                            ? "bg-primary shadow-[0_0_12px_var(--primary)]"
                            : "bg-[#c2c0b4] dark:bg-[#b8b5a8] group-hover:bg-[#d8d6cc]"
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    {/* Tooltip on Hover */}
                    {isHovered && (
                      <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 bg-popover border border-border rounded px-2.5 py-1 text-xs text-popover-foreground font-mono shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                        <span className="font-bold text-primary">{item.displayValue}</span>
                        <span className="text-muted-foreground/45">|</span>
                        <span>{item.comparison}</span>
                      </div>
                    )}
                  </div>

                  <div className="hidden md:flex w-48 justify-between items-center text-right font-mono text-xs">
                    <span className={`text-sm ${item.isFreeCode ? "text-primary font-semibold" : "text-foreground/90"}`}>
                      {item.displayValue}
                    </span>
                    <span className="text-muted-foreground/60 text-[10px] w-24">
                      {item.comparison}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart 2: Time to Ready */}
        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <div className="flex items-start gap-4 mb-6">
            <div>
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                Time to ready (seconds)
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Startup latency: wall-clock from spawn until input handling is responsive (10 interactive PTY launches each).
              </p>
            </div>
          </div>

          <div className="space-y-4 mb-6">
            {timeToReadyData.map((item) => {
              const widthPct = ((item.value || 0) / maxTime) * 100;
              const isHovered = hoveredIndex === `time-${item.tool}`;
              return (
                <div
                  key={item.tool}
                  className="group relative flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-border hover:bg-accent/10 px-2 rounded transition-colors"
                  onMouseEnter={() => setHoveredIndex(`time-${item.tool}`)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="w-full md:w-32 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                    <span className={`font-mono text-sm ${item.isFreeCode ? "text-primary font-bold animate-pulse" : "text-foreground/70"}`}>
                      {item.tool}
                    </span>
                    <span className="md:hidden text-xs text-muted-foreground/60">{item.displayValue}</span>
                  </div>

                  <div className="flex-1 mx-0 md:mx-6 flex items-center relative h-6">
                    <div className="w-full bg-muted h-3.5 rounded overflow-hidden border border-border">
                      <div
                        className={`h-full transition-all duration-1000 ease-out ${
                          item.isFreeCode
                            ? "bg-primary shadow-[0_0_12px_var(--primary)]"
                            : "bg-[#c2c0b4] dark:bg-[#b8b5a8] group-hover:bg-[#d8d6cc]"
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    {/* Tooltip on Hover */}
                    {isHovered && (
                      <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 bg-popover border border-border rounded px-2.5 py-1 text-xs text-popover-foreground font-mono shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                        <span className="font-bold text-primary">{item.displayValue}</span>
                        <span className="text-muted-foreground/45">|</span>
                        <span>{item.comparison}</span>
                      </div>
                    )}
                  </div>

                  <div className="hidden md:flex w-48 justify-between items-center text-right font-mono text-xs">
                    <span className={`text-sm ${item.isFreeCode ? "text-primary font-semibold" : "text-foreground/90"}`}>
                      {item.displayValue}
                    </span>
                    <span className="text-muted-foreground/60 text-[10px] w-24">
                      {item.comparison}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2.5 mt-4 p-4 rounded bg-muted border border-border">
            <p className="text-xs text-muted-foreground leading-relaxed">
              codex, opencode and copilot_cli hit the 20s timeout without becoming input ready; antigravity_cli never rendered visible.
            </p>
          </div>
        </div>

        {/* Chart 3: Memory scaling per additional session */}
        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <div className="flex items-start gap-4 mb-6">
            <div>
              <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
                Memory per session, avg over 10 runs (MB)
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Extra proportional memory (PSS) each additional client adds once one is already running. Ten freecode sessions cost about 250 MB, less than one sixth of one Claude Code.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {memory10SessionsData.map((item) => {
              const widthPct = ((item.value || 0) / maxMemory10) * 100;
              const isHovered = hoveredIndex === `mem10-${item.tool}`;
              return (
                <div
                  key={item.tool}
                  className="group relative flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-border hover:bg-accent/10 px-2 rounded transition-colors"
                  onMouseEnter={() => setHoveredIndex(`mem10-${item.tool}`)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="w-full md:w-32 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                    <span className={`font-mono text-sm ${item.isFreeCode ? "text-primary font-bold animate-pulse" : "text-foreground/70"}`}>
                      {item.tool}
                    </span>
                    <span className="md:hidden text-xs text-muted-foreground/60">{item.displayValue}</span>
                  </div>

                  <div className="flex-1 mx-0 md:mx-6 flex items-center relative h-6">
                    <div className="w-full bg-muted h-3.5 rounded overflow-hidden border border-border">
                      <div
                        className={`h-full transition-all duration-1000 ease-out ${
                          item.isFreeCode
                            ? "bg-primary shadow-[0_0_12px_var(--primary)]"
                            : "bg-[#c2c0b4] dark:bg-[#b8b5a8] group-hover:bg-[#d8d6cc]"
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    {/* Tooltip on Hover */}
                    {isHovered && (
                      <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 bg-popover border border-border rounded px-2.5 py-1 text-xs text-popover-foreground font-mono shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                        <span className="font-bold text-primary">{item.displayValue}</span>
                        <span className="text-muted-foreground/45">|</span>
                        <span>{item.comparison}</span>
                      </div>
                    )}
                  </div>

                  <div className="hidden md:flex w-48 justify-between items-center text-right font-mono text-xs">
                    <span className={`text-sm ${item.isFreeCode ? "text-primary font-semibold" : "text-foreground/90"}`}>
                      {item.displayValue}
                    </span>
                    <span className="text-muted-foreground/60 text-[10px] w-24">
                      {item.comparison}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
