import { logoLines, logoTagline } from "../assets/logo";
import { Button } from "./Button";

export function Hero() {
  return (
    <div className="flex flex-col items-center gap-4 mb-12">
      <pre className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-8 py-6 font-mono text-[11px] leading-tight text-cyan-400 whitespace-pre overflow-x-auto -mt-8">
        {logoLines.join("\n")}
      </pre>
      <p className="text-sm text-white/60 tracking-widest">{logoTagline}</p>
      <div className="max-w-lg mt-8">
        <h1 className="text-3xl font-bold text-white mb-3 tracking-tight sm:text-5xl whitespace-nowrap">
            Your AI Coding Assistant
          </h1>
        <p className="text-base text-white/70 leading-relaxed sm:text-lg">
          Drive AI coding assistants via browser automation. No API costs.
          Works with ChatGPT, Claude, and Gemini.
        </p>
      </div>
      <div className="flex gap-4 mt-6">
        <Button variant="primary" href="/internal">
          View Architecture
        </Button>
        <Button
          variant="outline"
          href="https://github.com/ayan-de/freecode"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </Button>
      </div>
    </div>
  );
}