import { logoLines, logoTagline } from "./assets/logo";
import { Installation } from "./components/Installation";
import { Button } from "./components/Button";
import { Divider } from "./components/Divider";

const offset = "max(80px, calc((100vw - 1280px) / 2))";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-black via-[#0a0a0a] to-[#1a1a2e]">
      <div className="fixed top-0 bottom-0 left-[max(80px,calc((100vw-1280px)/2))] w-px bg-white/15 z-50" />
      <div className="fixed top-0 bottom-0 right-[max(80px,calc((100vw-1280px)/2))] w-px bg-white/15 z-50" />

      <main className="flex flex-col items-center py-20 text-center">
        <div className="flex flex-col items-center gap-4 mb-12">
          <pre className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-8 py-6 font-mono text-[11px] leading-tight text-cyan-400 whitespace-pre overflow-x-auto">
{logoLines.join("\n")}
          </pre>
          <p className="text-sm text-white/60 tracking-widest">{logoTagline}</p>
        </div>

        <div
          className="absolute left-0 right-0 border-t border-white/20"
          style={{ left: offset, right: offset }}
        />

        <div className="max-w-lg mt-12 mb-12">
          <h1 className="text-3xl font-bold text-white mb-3 tracking-tight sm:text-5xl">
            Your AI Coding Assistant
          </h1>
          <p className="text-base text-white/70 leading-relaxed sm:text-lg">
            Drive AI coding assistants via browser automation. No API costs.
            Works with ChatGPT, Claude, and Gemini.
          </p>
        </div>

        <div
          className="absolute left-0 right-0 border-t border-white/20"
          style={{ left: offset, right: offset }}
        />

        <div className="mt-12 mb-12">
          <Installation />
        </div>

        <div
          className="absolute left-0 right-0 border-t border-white/20"
          style={{ left: offset, right: offset }}
        />

        <div className="flex gap-4 mt-12">
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
      </main>

      <footer className="fixed bottom-0 left-0 right-0 flex items-center justify-center gap-6 py-4 px-[max(80px,calc((100vw-1280px)/2))] text-sm text-white/40">
        <a href="https://freecode.ayande.xyz/" target="_blank" rel="noopener noreferrer">
          freecode.ayande.xyz
        </a>
        <a href="https://github.com/ayan-de/freecode" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
}