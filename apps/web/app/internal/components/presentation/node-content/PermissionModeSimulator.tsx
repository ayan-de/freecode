"use client";

import { useState } from "react";
import styles from "../ArchitectureExplorer.module.css";

type Mode = "plan" | "build" | "review" | "explore" | "danger";
type Decision = "allow" | "ask" | "deny";

interface Outcome {
  decision: Decision;
  source: string;
}

interface SampleCall {
  call: string;
  outcomes: Record<Mode, Outcome>;
}

const MODES: Mode[] = ["plan", "build", "review", "explore", "danger"];

const MODE_BLURBS: Record<Mode, string> = {
  plan: "Read-only enforced. Mutations are denied before rules run — even an allow rule cannot override.",
  build: "Default mode. Rules decide first; unmatched mutations trigger the interactive permission prompt.",
  review: "Read-only, with one carve-out: rules may explicitly allow bash (e.g. Bash(git diff:*)).",
  explore: "Read-only and silent — it never prompts. Any ask outcome downgrades to deny.",
  danger: "Bypasses everything: no rules, no hooks, no prompts. Even deny rules are skipped. Explicit per-session opt-in.",
};

// Demo settings: allow: ["Bash(npm run test:*)"], deny: ["Read(.env*)"]
const SAMPLE_CALLS: SampleCall[] = [
  {
    call: 'read("src/db.ts")',
    outcomes: {
      plan: { decision: "allow", source: "mode default (read-only tool)" },
      build: { decision: "allow", source: "mode default (read inside project)" },
      review: { decision: "allow", source: "mode default (read-only tool)" },
      explore: { decision: "allow", source: "mode default (read-only tool)" },
      danger: { decision: "allow", source: "danger bypass" },
    },
  },
  {
    call: 'bash("npm run test")  — allow rule matches',
    outcomes: {
      plan: { decision: "deny", source: "mode-enforced: read-only beats allow rule" },
      build: { decision: "allow", source: "rule Bash(npm run test:*)" },
      review: { decision: "allow", source: "rule Bash(npm run test:*) — bash carve-out" },
      explore: { decision: "deny", source: "mode-enforced: read-only beats allow rule" },
      danger: { decision: "allow", source: "danger bypass" },
    },
  },
  {
    call: 'read(".env.local")  — deny rule matches',
    outcomes: {
      plan: { decision: "deny", source: "rule Read(.env*) — deny is absolute" },
      build: { decision: "deny", source: "rule Read(.env*) — deny is absolute" },
      review: { decision: "deny", source: "rule Read(.env*) — deny is absolute" },
      explore: { decision: "deny", source: "rule Read(.env*) — deny is absolute" },
      danger: { decision: "allow", source: "danger bypass — deny rules not consulted" },
    },
  },
  {
    call: 'write("src/app.ts")  — no rule',
    outcomes: {
      plan: { decision: "deny", source: "mode-enforced (read-only)" },
      build: { decision: "ask", source: "mode default → interactive prompt" },
      review: { decision: "deny", source: "mode-enforced (read-only)" },
      explore: { decision: "deny", source: "mode-enforced (read-only)" },
      danger: { decision: "allow", source: "danger bypass" },
    },
  },
  {
    call: 'bash("git push origin main")  — no rule',
    outcomes: {
      plan: { decision: "deny", source: "mode-enforced (read-only)" },
      build: { decision: "ask", source: "mode default → interactive prompt" },
      review: { decision: "deny", source: "mode default (unmatched bash)" },
      explore: { decision: "deny", source: "mode-enforced (read-only)" },
      danger: { decision: "allow", source: "danger bypass" },
    },
  },
];

const DECISION_STYLE: Record<Decision, string> = {
  allow: styles.hookSuccess ?? "",
  ask: styles.hookPre ?? "",
  deny: styles.errorText ?? "",
};

export function PermissionModeSimulator() {
  const [mode, setMode] = useState<Mode>("build");

  return (
    <div className={styles.simContainer}>
      <div className={styles.simHeader}>
        <span>Permission Decision Simulator — pick an agent mode</span>
        <span className={styles.emeraldPulse}></span>
      </div>
      <div className={styles.hooksSandbox}>
        <div className={styles.hooksToggle}>
          {MODES.map((m) => (
            <button
              key={m}
              className={`${styles.toggleBtn} ${
                mode === m
                  ? m === "danger"
                    ? styles.toggleActiveUnsafe
                    : styles.toggleActiveSafe
                  : ""
              }`}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <div className={styles.sandboxOutput}>
          <div className={styles.hookConsoleLog}>
            <div className={styles.hookLogLine}>
              <span className={styles.hookInfo}>[MODE]</span> {MODE_BLURBS[mode]}
            </div>
            <div className={styles.hookLogLine}>
              <span className={styles.hookInfo}>[RULES]</span> allow:{" "}
              <code>Bash(npm run test:*)</code> · deny: <code>Read(.env*)</code>
            </div>
            {SAMPLE_CALLS.map((sample) => {
              const outcome = sample.outcomes[mode];
              return (
                <div className={styles.hookLogLine} key={sample.call}>
                  <span className={DECISION_STYLE[outcome.decision]}>
                    [{outcome.decision.toUpperCase()}]
                  </span>{" "}
                  <code>{sample.call}</code>{" "}
                  <span className={styles.hookInfo}>— {outcome.source}</span>
                </div>
              );
            })}
            {mode === "build" && (
              <div className={styles.hookLogLine}>
                <span className={styles.hookPost}>[PROMPT]</span> ASK opens the
                frontend picker: allow once · this session · this project
                (.freecode/settings.json) · always (~/.freecode/settings.json) ·
                deny. Headless or timed-out asks resolve to deny.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
