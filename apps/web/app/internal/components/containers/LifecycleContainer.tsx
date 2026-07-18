"use client";

import styles from "./LifecycleContainer.module.css";

interface Hook {
  name: string;
  purpose: string;
  block: boolean;
  modify: string; // what it can rewrite/inject, or "—"
}

interface Phase {
  title: string;
  when: string;
  hooks: Hook[];
}

// Source of truth: apps/core/src/hooks/types.ts (HOOK_EVENT_NAMES) — 14 hooks.
const PHASES: Phase[] = [
  {
    title: "1)Session",
    when: "once — when a session opens and when the loop finally stops",
    hooks: [
      { name: "SessionStart", purpose: "Initialize session state; inject startup context", block: false, modify: "context" },
      { name: "Stop", purpose: "Cleanup when the agent loop terminates", block: false, modify: "—" },
    ],
  },
  {
    title: "2)Turn",
    when: "around every turn of the loop, plus the incoming user prompt",
    hooks: [
      { name: "TurnStart", purpose: "Per-turn setup; inject context before the model call", block: false, modify: "context" },
      { name: "UserPromptSubmit", purpose: "Rewrite the user prompt before it reaches the model — or block it", block: true, modify: "prompt" },
      { name: "TurnEnd", purpose: "After a turn: usage/cost tracking, logging; may inject context", block: false, modify: "context" },
    ],
  },
  {
    title: "3)Tool call",
    when: "for each tool the model invokes",
    hooks: [
      { name: "PreToolUse", purpose: "Validate/rewrite a tool call before it runs — or block it", block: true, modify: "input" },
      { name: "PermissionRequest", purpose: "Override the rules-engine verdict (allow / deny / ask) for a risky call", block: true, modify: "decision" },
      { name: "PostToolUse", purpose: "Process/rewrite the result; inject follow-up context", block: false, modify: "output" },
      { name: "PostToolUseFailure", purpose: "React to a failed tool call; inject recovery hints", block: false, modify: "context" },
    ],
  },
  {
    title: "4)Compaction",
    when: "when the context window fills and old turns get summarized",
    hooks: [
      { name: "PreCompact", purpose: "Inspect context before compaction; may veto (defer) it", block: true, modify: "—" },
      { name: "PostCompact", purpose: "Verify/log the summary; inject context afterwards", block: false, modify: "context" },
    ],
  },
  {
    title: "5)Sub-agent",
    when: "when the loop spawns a nested sub-agent and when it finishes",
    hooks: [
      { name: "SubagentStart", purpose: "Initialize a spawned sub-agent's context", block: false, modify: "context" },
      { name: "SubagentStop", purpose: "Collect results when a sub-agent completes", block: false, modify: "context" },
    ],
  },
  {
    title: "6)Attention",
    when: "any time the agent needs the user (approval prompt, idle, etc.)",
    hooks: [
      { name: "Notification", purpose: "Fire-and-forget alert to the user (e.g. desktop/Slack notify)", block: false, modify: "—" },
    ],
  },
];

const FILES: { badge: string; path: string }[] = [
  { badge: "Runtime", path: "apps/core/src/hooks/runtime.ts" },
  { badge: "Registry", path: "apps/core/src/hooks/registry.ts" },
  { badge: "Types", path: "apps/core/src/hooks/types.ts (HOOK_EVENT_NAMES)" },
  { badge: "Executors", path: "apps/core/src/hooks/executors/ (command · callback)" },
  { badge: "Wiring", path: "apps/core/src/agent/loop.ts" },
  { badge: "Reference", path: "apps/core/src/hooks/hooks-system.md" },
];

export function LifecycleContainer() {
  return (
    <div className={styles.container}>
      <div className={styles.intro}>
        <h3 className={styles.introTitle}>Lifecycle Hooks</h3>
        <p className={styles.introText}>
          Hooks are <strong>interception points</strong> at key moments of the
          agent&apos;s run. They are the main way to customize behavior{" "}
          <strong>without editing the loop</strong>. There are{" "}
          <strong>14</strong> of them (<code>HOOK_EVENT_NAMES</code>), each
          defined as a shell <code>command</code>, an internal{" "}
          <code>callback</code>, or an LLM <code>prompt</code>, and matched to
          tools by pattern (e.g. <code>Write</code>, <code>Bash(git *)</code>).
        </p>
        <p className={styles.introText}>
          Depending on the point, a hook can <strong>block</strong> the action
          or <strong>modify</strong> it — rewrite a prompt, a tool&apos;s input
          or output, or inject extra context for the model.
        </p>
      </div>

      <div className={styles.phases}>
        {PHASES.map((phase) => (
          <div key={phase.title} className={styles.phase}>
            <div className={styles.phaseHeader}>
              <span className={styles.phaseTitle}>{phase.title}</span>
            </div>
            <p className={styles.phaseWhen}>fires {phase.when}</p>
            <div className={styles.table}>
              <table className={styles.hooksTable}>
                <thead>
                  <tr>
                    <th>Hook</th>
                    <th>Purpose</th>
                    <th>Can block?</th>
                    <th>Can modify</th>
                  </tr>
                </thead>
                <tbody>
                  {phase.hooks.map((hook) => (
                    <tr key={hook.name}>
                      <td className={styles.hookName}>{hook.name}</td>
                      <td className={styles.purpose}>{hook.purpose}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${hook.block ? styles.blockYes : styles.blockNo}`}
                        >
                          {hook.block ? "blocks" : "—"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${hook.modify === "—" ? styles.modNo : styles.modYes}`}
                        >
                          {hook.modify}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.note}>
        <h4 className={styles.noteTitle}>
          Lifecycle hooks vs. the permission rules engine
        </h4>
        <p className={styles.noteText}>
          They are <strong>not</strong> the same thing.{" "}
          <code>PermissionRequest</code> is one of the 14{" "}
          <strong>lifecycle hooks</strong> above. What is separate is the{" "}
          <strong>permission rules engine</strong> (
          <code>apps/core/src/permission/</code>) — the user-editable{" "}
          <code>allow</code> / <code>ask</code> / <code>deny</code> rule matcher.
        </p>
        <p className={styles.noteText}>
          For each tool call the order is: the <strong>rules engine decides
          first</strong> (a <code>deny</code> is absolute and short-circuits),
          then the <code>PermissionRequest</code> <strong>hook</strong> can
          override an <code>ask → allow</code> or turn anything into a deny. So
          the rules engine is the <strong>policy</strong>; the hook is the{" "}
          <strong>programmable override</strong>.
        </p>
      </div>

      <div className={styles.files}>
        <h4 className={styles.filesTitle}>Key Codebase Implementations</h4>
        <ul className={styles.filesList}>
          {FILES.map((f) => (
            <li key={f.badge}>
              <span className={styles.fileBadge}>{f.badge}</span>
              <span className={styles.fileLink}>{f.path}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
