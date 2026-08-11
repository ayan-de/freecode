// =============================================================================
// Autonomous Runs Reporting — report.md from the manifest + task cards
// PRIMARY: renders a run into something a human can skim in two minutes.
// v1 has no writer that populates task cards yet — that's a lightweight
// continuation-prompt instruction telling the model to write one after each
// meaningful unit of work (§4.5: cheaper than a dedicated extraction pass,
// since it runs once per turn rather than once per ~25 turns like Layer 1's
// distiller can afford). Not built in this pass; the report still renders
// correctly with zero cards — it just has less to show than a run that has
// them. Documented gap, not silently assumed away.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §4.5
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { getRunDir } from "./run-store.js";
import type { RunManifest, TaskCard } from "./types.js";

export function getTaskCardsDir(runId: string): string {
  return path.join(getRunDir(runId), "task-cards");
}

export function getReportPath(runId: string): string {
  return path.join(getRunDir(runId), "report.md");
}

/** Reads every task-cards/*.json, sorted by createdAt. Corrupt files are skipped, never thrown. */
export function readTaskCards(runId: string): TaskCard[] {
  const dir = getTaskCardsDir(runId);
  if (!fs.existsSync(dir)) return [];
  const cards: TaskCard[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      cards.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")));
    } catch {
      // skip a corrupt card rather than losing the rest of the report
    }
  }
  return cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function generateReportMarkdown(
  manifest: RunManifest,
  taskCards: TaskCard[],
): string {
  const lines: string[] = [];
  lines.push(`# Autonomous run ${manifest.id}`);
  lines.push("");
  lines.push(`- **Status:** ${manifest.status}${manifest.stopReason ? ` (${manifest.stopReason})` : ""}`);
  if (manifest.mission) lines.push(`- **Mission:** ${manifest.mission}`);
  lines.push(`- **Verify command:** \`${manifest.verifyCommand}\``);
  if (manifest.worktreePath) lines.push(`- **Worktree:** ${manifest.worktreePath}`);
  lines.push(
    `- **Usage:** ${manifest.usage.turns} turn(s), ${manifest.usage.countedTokens} token(s), ${fmtMs(manifest.usage.elapsedMs)}` +
      (manifest.usage.usd > 0 ? `, $${manifest.usage.usd.toFixed(2)}` : ""),
  );
  lines.push(
    `- **Limits:** maxTurns=${manifest.limits.maxTurns}, maxTokens=${manifest.limits.maxTokens}, timeoutMs=${manifest.limits.timeoutMs}, maxUsd=${manifest.limits.maxUsd}`,
  );
  lines.push(`- **Created:** ${manifest.createdAt}`);
  lines.push(`- **Updated:** ${manifest.updatedAt}`);
  lines.push("");

  if (taskCards.length === 0) {
    lines.push("_No task cards were recorded for this run._");
    lines.push("");
  } else {
    lines.push(`## Task cards (${taskCards.length})`);
    lines.push("");
    for (const card of taskCards) {
      lines.push(`### ${card.outcome === "success" ? "✅" : card.outcome === "partial" ? "⚠️" : "❌"} ${card.before.problem}`);
      if (card.before.evidence) lines.push(`- **Evidence:** ${card.before.evidence}`);
      lines.push(`- **Change:** ${card.after.change}`);
      if (card.after.filesChanged?.length) {
        lines.push(`- **Files:** ${card.after.filesChanged.join(", ")}`);
      }
      if (card.validation?.commands?.length) {
        lines.push(`- **Validated with:** ${card.validation.commands.join(", ")}${card.validation.result ? ` → ${card.validation.result}` : ""}`);
      }
      lines.push("");
    }
  }

  lines.push(
    manifest.status === "completed"
      ? "This run stopped because the verify command passed. Verification-gated is not the same as verification-*sound* — the gate is only as strong as the command supplied."
      : `This run did not reach a passing verify command. Review the worktree before trusting any of its changes.`,
  );
  return `${lines.join("\n")}\n`;
}

export function writeReport(manifest: RunManifest): string {
  const taskCards = readTaskCards(manifest.id);
  const reportPath = getReportPath(manifest.id);
  fs.mkdirSync(getRunDir(manifest.id), { recursive: true });
  fs.writeFileSync(reportPath, generateReportMarkdown(manifest, taskCards), "utf-8");
  return reportPath;
}
