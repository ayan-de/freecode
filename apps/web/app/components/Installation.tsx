"use client";

import { useState } from "react";
import styles from "./Installation.module.css";

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
    command: "brew install thisisayande/tap/freecode",
  },
  paru: {
    label: "paru",
    command: "paru -S freecode",
  },
} as const;

type Installer = keyof typeof installers;

const InstallTabs = ["curl", "npm", "bun", "brew", "paru"] as const;

function CopyButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button className={styles.copyBtn} onClick={handleCopy} type="button">
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function Installation() {
  const [active, setActive] = useState<Installer>("curl");

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Install FreeCode</h2>
      <div className={styles.tabs}>
        {InstallTabs.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${active === tab ? styles.active : ""}`}
            onClick={() => setActive(tab)}
            type="button"
          >
            {installers[tab].label}
          </button>
        ))}
      </div>
      <div className={styles.codeBlock}>
        <code className={styles.command}>{installers[active].command}</code>
        <CopyButton command={installers[active].command} />
      </div>
    </div>
  );
}