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
    <div id="installation" className="w-full max-w-xl mx-auto">
      <h2 className="text-2xl font-semibold text-white text-center mb-2">
        Get Started in Seconds
      </h2>
      <p className="text-base text-white/60 text-center mb-6">
        One command to install FreeCode and start using AI coding assistants.
      </p>

      <div className="rounded-sm border border-white/15 bg-black/30 overflow-hidden">
        <div className="flex items-center border-b border-white/15">
          <div className="flex items-center px-4 py-3 border-r border-white/15 text-white/50">
            <Terminal size={16} />
          </div>
          <div className="flex flex-1">
            {InstallTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActive(tab)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                  active === tab
                    ? "text-cyan-400 border-cyan-400"
                    : "text-white/50 border-transparent hover:text-white/80"
                }`}
              >
                {installers[tab].label}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="px-4 py-3 text-white/50 hover:text-cyan-400 transition-colors border-l border-white/15"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        <div className="p-4 text-left">
          <code className="font-mono text-sm text-cyan-400">$ {installers[active].command}</code>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-8 text-center">
        <div>
          <div className="text-3xl font-bold text-white">No</div>
          <div className="text-sm text-white/50 mt-1">API Costs</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-white">3</div>
          <div className="text-sm text-white/50 mt-1">AI Providers</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-white">~30s</div>
          <div className="text-sm text-white/50 mt-1">Install Time</div>
        </div>
      </div>
    </div>
  );
}