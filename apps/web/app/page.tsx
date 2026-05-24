import { Installation } from "./components/Installation";
import { Divider } from "./components/Divider";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";

const offset = "max(80px, calc((100vw - 1280px) / 2))";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-black via-[#0a0a0a] to-[#1a1a2e]">
      <Navbar />
      <div className="fixed top-0 bottom-0 left-[max(80px,calc((100vw-1280px)/2))] w-px bg-white/15 z-50" />
      <div className="fixed top-0 bottom-0 right-[max(80px,calc((100vw-1280px)/2))] w-px bg-white/15 z-50" />

      <main className="flex flex-col items-center py-20 text-center px-[max(80px,calc((100vw-1280px)/2))]">
        <Hero />

        <Divider />

        <div className="mt-12 mb-12">
          <Installation />
        </div>

        <Divider />
      </main>

      <footer className="flex items-center justify-center gap-6 py-4 px-[max(80px,calc((100vw-1280px)/2))] text-sm text-white/40">
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