"use client";

import { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";

const installers = {
  curl: {
    label: "curl",
    command: 'curl -fsSL https://freecode.ayande.xyz/install | bash',
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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installers[active].command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="installation" className="w-full max-w-2xl mx-auto">
      <h2 className="text-3xl lg:text-4xl font-semibold text-white text-center mb-3">
        Get Started in Seconds
      </h2>
      <p className="text-lg lg:text-xl text-white/60 text-center mb-8">
        One command to install FreeCode and start using AI coding assistants.
      </p>

      <div className="rounded-md border border-white/15 bg-black/30 overflow-hidden">
        <div className="flex items-center border-b border-white/15">
          <div className="flex items-center px-5 py-4 border-r border-white/15 text-white/50">
            <Terminal size={18} />
          </div>
          <div className="flex flex-1">
            {InstallTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActive(tab)}
                className={`px-6 py-4 text-base font-medium transition-colors border-b-2 ${
                  active === tab
                    ? "brand-gradient-text border-current"
                    : "text-white/50 border-transparent hover:brand-gradient-text"
                }`}
              >
                {installers[tab].label}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="px-5 py-4 text-white/50 hover:brand-gradient-text transition-colors border-l border-white/15"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
        <div className="p-5 text-left">
          <code className="font-mono text-lg">
            <span className="text-white">$ </span>
            <span className="brand-gradient-text">{installers[active].command}</span>
          </code>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8 mt-12 text-center">
        <div>
          <div className="text-4xl lg:text-5xl font-bold text-white">No</div>
          <div className="text-base lg:text-lg text-white/50 mt-2">API Costs</div>
        </div>
        <div>
          <div className="text-4xl lg:text-5xl font-bold text-white">3</div>
          <div className="text-base lg:text-lg text-white/50 mt-2">AI Providers</div>
        </div>
        <div>
          <div className="text-4xl lg:text-5xl font-bold text-white">~30s</div>
          <div className="text-base lg:text-lg text-white/50 mt-2">Install Time</div>
        </div>
      </div>
    </div>
  );
}