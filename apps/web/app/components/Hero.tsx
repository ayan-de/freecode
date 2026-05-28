import { Button } from "./Button";
import { HeroGrid } from "./HeroGrid";

export function Hero() {
  return (
    <div className="relative w-full mb-0 px-4 lg:px-0 min-h-[80vh] flex items-center justify-start isolate">
      {/* Background Grid */}
      <HeroGrid />

      {/* Foreground Content */}
      <div className="relative z-10 flex flex-col items-start text-left gap-6 w-full max-w-6xl mx-auto mt-0 py-12 ml-8">
        <h1 className="text-5xl lg:text-[4.5rem] font-bold text-white tracking-tight leading-[1.1] max-w-3xl">
          Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">AI</span> Coding Assistant
        </h1>
        <p className="text-lg lg:text-xl text-white/60 leading-relaxed max-w-xl">
          Drive AI coding assistants via browser automation. No API costs. Works with <span className="text-white font-medium">ChatGPT</span>, <span className="text-white font-medium">Claude</span>, and <span className="text-white font-medium">Gemini</span>.
        </p>

        <div className="flex flex-wrap items-center gap-4 mt-4 mb-2">
          <Button variant="primary" className="px-6 py-3" href="/internal">
            View Architecture
          </Button>
          <Button
            variant="outline"
            className="px-6 py-3 hover:border-white/20 hover:bg-white/5 h-[46px]"
            href="https://github.com/ayan-de/freecode"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </Button>
        </div>
      </div>
    </div>
  );
}