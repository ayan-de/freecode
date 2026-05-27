// import { logoLines, logoTagline } from "../assets/logo";
import { Button } from "./Button";

export function Hero() {
  return (
    <div className="flex flex-col items-start gap-4 mb-12 w-full max-w-xl mx-auto">
      <div className="mt-8 text-left">
        <h1 className="text-3xl font-bold text-white mb-3 tracking-tight sm:text-5xl leading-tight">
          Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">AI</span> Coding Assistant
        </h1>
        <p className="text-base text-white/70 leading-relaxed sm:text-lg">
          Drive AI coding assistants via browser automation. No API costs. Works with <span className="text-white font-medium">ChatGPT</span>, <span className="text-white font-medium">Claude</span>, and <span className="text-white font-medium">Gemini</span>.
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