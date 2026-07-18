"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Check, Terminal } from "lucide-react";

const installers = {
  curl: {
    label: "curl",
    command: "curl -fsSL https://freecode.ayande.xyz/install | bash",
  },
  npm: {
    label: "npm",
    command: "npm i -g freecode",
  },
  bun: {
    label: "bun",
    command: "bun add -g freecode",
  },
  brew: {
    label: "brew",
    command: "brew install anomalyco/tap/freecode",
  },
  paru: {
    label: "paru",
    command: "paru -S freecode",
  },
} as const;

type Installer = keyof typeof installers;

const InstallTabs = ["curl", "npm", "bun", "brew", "paru"] as const;

export function Installation() {
  const [active, setActive] = useState<Installer>("curl");
  const [copied, setCopied] = useState(false);
  const [sticky, setSticky] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Show sticky header when the bottom of the installation box has scrolled past the top of the screen
      setSticky(rect.bottom < 0);
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll(); // Initial check

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installers[active].command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div ref={containerRef} id="installation" className="w-full max-w-2xl mx-auto">
      {/* Sticky Header Floating Command Bar */}
      {sticky && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center border border-primary bg-card rounded-md shadow-md divide-x divide-border overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300 w-max max-w-[90vw] md:max-w-2xl">
          <div className="px-4 py-2 font-mono text-xs md:text-sm text-foreground whitespace-nowrap overflow-hidden">
            {installers[active].command}
          </div>
          <button
            onClick={handleCopy}
            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-primary active:scale-95 transition-all bg-card shrink-0 flex items-center gap-1"
          >
            {copied ? (
              <>
                <Check size={14} className="text-emerald-500" />
                copied
              </>
            ) : (
              "copy"
            )}
          </button>
        </div>
      )}

      <h2 className="text-3xl lg:text-4xl font-semibold text-foreground text-center mb-3">
        Get Started in Seconds
      </h2>
      <p className="text-lg lg:text-xl text-muted-foreground text-center mb-8">
        One command to install FreeCode and start using AI coding assistants.
      </p>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="flex items-center border-b border-border">
          <div className="flex items-center px-5 py-4 border-r border-border text-muted-foreground/60">
            <Terminal size={18} />
          </div>
          <div className="flex flex-1">
            {InstallTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActive(tab)}
                className={`px-6 py-4 text-base font-medium transition-colors border-b-2 ${
                  active === tab
                    ? "text-primary border-primary font-semibold"
                    : "text-muted-foreground/60 border-transparent hover:text-primary"
                }`}
              >
                {installers[tab].label}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="px-5 py-4 text-muted-foreground/60 hover:text-primary transition-colors border-l border-border"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
        <div className="p-5 text-left bg-muted/10">
          <code className="font-mono text-lg">
            <span className="text-foreground">$ </span>
            <span className="text-primary font-medium">
              {installers[active].command}
            </span>
          </code>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8 mt-12 text-center">
        <div>
          <div className="text-4xl lg:text-5xl font-bold text-foreground">No</div>
          <div className="text-base lg:text-lg text-muted-foreground mt-2">
            API Costs
          </div>
        </div>
        <div>
          <div className="text-4xl lg:text-5xl font-bold text-foreground">3</div>
          <div className="text-base lg:text-lg text-muted-foreground mt-2">
            AI Providers
          </div>
        </div>
        <div>
          <div className="text-4xl lg:text-5xl font-bold text-foreground">~30s</div>
          <div className="text-base lg:text-lg text-muted-foreground mt-2">
            Install Time
          </div>
        </div>
      </div>
    </div>
  );
}
