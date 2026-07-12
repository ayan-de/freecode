"use client";

import { useState } from "react";
import { Info, BarChart3, Clock, Cpu } from "lucide-react";

interface BenchmarkItem {
  tool: string;
  value: number | null;
  displayValue: string;
  comparison: string;
  isFreeCode: boolean;
}

const memory1SessionData: BenchmarkItem[] = [
  { tool: "freecode", value: 38.3, displayValue: "38.3 MB", comparison: "baseline", isFreeCode: true },
  { tool: "pi", value: 119.8, displayValue: "119.8 MB", comparison: "3.1× more RAM", isFreeCode: false },
  { tool: "codex", value: 163.6, displayValue: "163.6 MB", comparison: "4.3× more RAM", isFreeCode: false },
  { tool: "claude_code", value: 185.1, displayValue: "185.1 MB", comparison: "4.8× more RAM", isFreeCode: false },
  { tool: "cursor_agent", value: 244.9, displayValue: "244.9 MB", comparison: "6.4× more RAM", isFreeCode: false },
  { tool: "copilot_cli", value: 277.2, displayValue: "277.2 MB", comparison: "7.2× more RAM", isFreeCode: false },
  { tool: "antigravity_cli", value: 420.1, displayValue: "420.1 MB", comparison: "11.0× more RAM", isFreeCode: false },
  { tool: "opencode", value: 1053.0, displayValue: "1,053.0 MB", comparison: "27.5× more RAM", isFreeCode: false },
];

const timeToReadyData: BenchmarkItem[] = [
  { tool: "freecode", value: 1.098, displayValue: "1.10 s", comparison: "baseline", isFreeCode: true },
  { tool: "claude_code", value: 1.409, displayValue: "1.41 s", comparison: "1.3× slower", isFreeCode: false },
  { tool: "cursor_agent", value: 1.715, displayValue: "1.71 s", comparison: "1.6× slower", isFreeCode: false },
  { tool: "pi", value: 4.623, displayValue: "4.62 s", comparison: "4.2× slower", isFreeCode: false },
];

const memory10SessionsData: BenchmarkItem[] = [
  { tool: "freecode", value: 25.8, displayValue: "25.8 MB", comparison: "baseline", isFreeCode: true },
  { tool: "codex", value: 56.1, displayValue: "56.1 MB", comparison: "2.2× more RAM", isFreeCode: false },
  { tool: "pi", value: 92.8, displayValue: "92.8 MB", comparison: "3.6× more RAM", isFreeCode: false },
  { tool: "claude_code", value: 164.7, displayValue: "164.7 MB", comparison: "6.4× more RAM", isFreeCode: false },
  { tool: "copilot_cli", value: 179.4, displayValue: "179.4 MB", comparison: "7.0× more RAM", isFreeCode: false },
  { tool: "cursor_agent", value: 210.9, displayValue: "210.9 MB", comparison: "8.2× more RAM", isFreeCode: false },
  { tool: "antigravity_cli", value: 266.2, displayValue: "266.2 MB", comparison: "10.3× more RAM", isFreeCode: false },
  { tool: "opencode", value: 794.3, displayValue: "794.3 MB", comparison: "30.8× more RAM", isFreeCode: false },
];

export function Benchmark() {
  const [hoveredIndex, setHoveredIndex] = useState<string | null>(null);

  // Maximum values for normalization
  const maxMemory1 = Math.max(...memory1SessionData.map(d => d.value || 0));
  const maxTime = Math.max(...timeToReadyData.map(d => d.value || 0));
  const maxMemory10 = Math.max(...memory10SessionsData.map(d => d.value || 0));

  return (
    <section id="benchmark" className="w-full max-w-4xl mx-auto py-12">
      <h2 className="text-3xl lg:text-4xl font-semibold text-white text-center mb-3">
        Performance & Resource Efficiency
      </h2>
      <p className="text-lg lg:text-xl text-white/60 text-center mb-12 max-w-2xl mx-auto">
        Swarms only push intelligence if they scale, and they only scale if each agent costs almost nothing. FreeCode is optimized to the bone so agents stay cheap to spawn, with none of it traded for speed.
      </p>

      <div className="flex flex-col gap-12">
        {/* Chart 1: Memory Footprint (1 session) */}
        <div className="rounded-md border border-white/15 bg-black/30 p-6 md:p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="p-2.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Cpu size={20} />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                Memory footprint (PSS, MB)
              </h3>
              <p className="text-sm text-white/50 mt-1">
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
                  className="group relative flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-white/5 hover:bg-white/[0.02] px-2 rounded transition-colors"
                  onMouseEnter={() => setHoveredIndex(`mem1-${item.tool}`)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="w-full md:w-32 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                    <span className={`font-mono text-sm ${item.isFreeCode ? "text-emerald-400 font-bold" : "text-white/70"}`}>
                      {item.tool}
                    </span>
                    <span className="md:hidden text-xs text-white/40">{item.displayValue}</span>
                  </div>

                  <div className="flex-1 mx-0 md:mx-6 flex items-center relative h-6">
                    <div className="w-full bg-white/[0.03] h-3.5 rounded overflow-hidden border border-white/5">
                      <div
                        className={`h-full transition-all duration-1000 ease-out ${
                          item.isFreeCode
                            ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                            : "bg-[#c2c0b4] group-hover:bg-[#d8d6cc]"
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    {/* Tooltip on Hover */}
                    {isHovered && (
                      <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 bg-zinc-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white/90 font-mono shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                        <span className="font-bold text-emerald-400">{item.displayValue}</span>
                        <span className="text-white/40">|</span>
                        <span>{item.comparison}</span>
                      </div>
                    )}
                  </div>

                  <div className="hidden md:flex w-48 justify-between items-center text-right font-mono text-xs">
                    <span className={`text-sm ${item.isFreeCode ? "text-emerald-400 font-semibold" : "text-white/90"}`}>
                      {item.displayValue}
                    </span>
                    <span className="text-white/40 text-[10px] w-24">
                      {item.comparison}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart 2: Time to Ready */}
        <div className="rounded-md border border-white/15 bg-black/30 p-6 md:p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="p-2.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Clock size={20} />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                Time to ready (seconds)
              </h3>
              <p className="text-sm text-white/50 mt-1">
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
                  className="group relative flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-white/5 hover:bg-white/[0.02] px-2 rounded transition-colors"
                  onMouseEnter={() => setHoveredIndex(`time-${item.tool}`)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="w-full md:w-32 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                    <span className={`font-mono text-sm ${item.isFreeCode ? "text-emerald-400 font-bold" : "text-white/70"}`}>
                      {item.tool}
                    </span>
                    <span className="md:hidden text-xs text-white/40">{item.displayValue}</span>
                  </div>

                  <div className="flex-1 mx-0 md:mx-6 flex items-center relative h-6">
                    <div className="w-full bg-white/[0.03] h-3.5 rounded overflow-hidden border border-white/5">
                      <div
                        className={`h-full transition-all duration-1000 ease-out ${
                          item.isFreeCode
                            ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                            : "bg-[#c2c0b4] group-hover:bg-[#d8d6cc]"
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    {/* Tooltip on Hover */}
                    {isHovered && (
                      <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 bg-zinc-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white/90 font-mono shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                        <span className="font-bold text-emerald-400">{item.displayValue}</span>
                        <span className="text-white/40">|</span>
                        <span>{item.comparison}</span>
                      </div>
                    )}
                  </div>

                  <div className="hidden md:flex w-48 justify-between items-center text-right font-mono text-xs">
                    <span className={`text-sm ${item.isFreeCode ? "text-emerald-400 font-semibold" : "text-white/90"}`}>
                      {item.displayValue}
                    </span>
                    <span className="text-white/40 text-[10px] w-24">
                      {item.comparison}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2.5 mt-4 p-4 rounded bg-white/[0.02] border border-white/5">
            <Info size={16} className="text-white/40 shrink-0 mt-0.5" />
            <p className="text-xs text-white/50 leading-relaxed">
              codex, opencode and copilot_cli hit the 20s timeout without becoming input ready; antigravity_cli never rendered visible.
            </p>
          </div>
        </div>

        {/* Chart 3: Memory scaling per additional session */}
        <div className="rounded-md border border-white/15 bg-black/30 p-6 md:p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="p-2.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <BarChart3 size={20} />
            </div>
            <div>
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                Memory per session, avg over 10 runs (MB)
              </h3>
              <p className="text-sm text-white/50 mt-1">
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
                  className="group relative flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-white/5 hover:bg-white/[0.02] px-2 rounded transition-colors"
                  onMouseEnter={() => setHoveredIndex(`mem10-${item.tool}`)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="w-full md:w-32 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                    <span className={`font-mono text-sm ${item.isFreeCode ? "text-emerald-400 font-bold" : "text-white/70"}`}>
                      {item.tool}
                    </span>
                    <span className="md:hidden text-xs text-white/40">{item.displayValue}</span>
                  </div>

                  <div className="flex-1 mx-0 md:mx-6 flex items-center relative h-6">
                    <div className="w-full bg-white/[0.03] h-3.5 rounded overflow-hidden border border-white/5">
                      <div
                        className={`h-full transition-all duration-1000 ease-out ${
                          item.isFreeCode
                            ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                            : "bg-[#c2c0b4] group-hover:bg-[#d8d6cc]"
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    {/* Tooltip on Hover */}
                    {isHovered && (
                      <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 bg-zinc-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white/90 font-mono shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                        <span className="font-bold text-emerald-400">{item.displayValue}</span>
                        <span className="text-white/40">|</span>
                        <span>{item.comparison}</span>
                      </div>
                    )}
                  </div>

                  <div className="hidden md:flex w-48 justify-between items-center text-right font-mono text-xs">
                    <span className={`text-sm ${item.isFreeCode ? "text-emerald-400 font-semibold" : "text-white/90"}`}>
                      {item.displayValue}
                    </span>
                    <span className="text-white/40 text-[10px] w-24">
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
