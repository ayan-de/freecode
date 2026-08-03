// =============================================================================
// PermissionModal — the gate the agent shows before running a tool that
// the user's permission profile doesn't auto-allow.
//
// Spec §4.4: the modal surfaces tool name + args, offers allow (with
// scope) or deny. If another device answered first the server returns
// -32002 (REQUEST_ALREADY_RESOLVED) — we render that as state, not
// failure, and close the modal.
//
// Spec §5.3: this is also the prompt that drives the foreground service
// state machine on Android (blocked → working when answered). The wire
// shape is unchanged.
// =============================================================================

import React, { useState, useEffect } from "react";
import { Shield, X, AlertTriangle } from "lucide-react";
import {
  useChatStore,
  type PendingPermission,
} from "../stores/chat-store";
import {
  answerPermission,
  rejectPermission,
  type PermissionDecision,
} from "../ipc-stub";

interface PermissionModalProps {
  permission: PendingPermission;
}

const ALREADY_RESOLVED_CODE = -32002;

export const PermissionModal: React.FC<PermissionModalProps> = ({
  permission,
}) => {
  const setPendingPermission = useChatStore((s) => s.setPendingPermission);
  const [submitting, setSubmitting] = useState<PermissionDecision | null>(null);
  const [editedRule, setEditedRule] = useState(permission.suggestedRule ?? "");
  const [resolvedNotice, setResolvedNotice] = useState<
    "answered" | "rejected" | null
  >(null);

  useEffect(() => {
    if (permission.resolved && resolvedNotice === null) {
      setResolvedNotice(permission.resolved);
      const t = setTimeout(() => {
        setPendingPermission(null);
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [permission.resolved, resolvedNotice, setPendingPermission]);

  if (resolvedNotice) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-[#121318] border border-border rounded-xl shadow-premium px-6 py-4 max-w-sm w-full text-center">
          <div className="text-sm text-gray-300">
            {resolvedNotice === "answered"
              ? "Already answered on another device."
              : "Already dismissed on another device."}
          </div>
        </div>
      </div>
    );
  }

  async function decide(decision: PermissionDecision) {
    if (submitting) return;
    setSubmitting(decision);
    try {
      const rule =
        decision === "allow-always" && editedRule
          ? editedRule
          : undefined;
      await answerPermission(permission.requestId, decision, rule);
      setPendingPermission(null);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === ALREADY_RESOLVED_CODE) {
        setResolvedNotice("answered");
      } else {
        setSubmitting(null);
        alert((err as Error).message || "Failed to submit decision");
      }
    }
  }

  async function dismiss() {
    if (submitting) return;
    setSubmitting("deny");
    try {
      await rejectPermission(permission.requestId);
      setPendingPermission(null);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === ALREADY_RESOLVED_CODE) {
        setResolvedNotice("rejected");
      } else {
        setSubmitting(null);
        alert((err as Error).message || "Failed to dismiss");
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg bg-[#121318] border border-border rounded-xl shadow-premium flex flex-col text-gray-200">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div className="flex items-start gap-3 pr-4">
            <Shield
              size={20}
              className="text-amber-400 flex-shrink-0 mt-0.5"
            />
            <div className="flex flex-col gap-1 min-w-0">
              <h2 className="text-base font-semibold text-white">
                Permission requested
              </h2>
              <p className="text-sm text-gray-400">
                The agent wants to use{" "}
                <code className="px-1.5 py-0.5 rounded bg-white/10 text-amber-300 text-xs font-mono">
                  {permission.toolName}
                </code>
                .
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="p-1 rounded text-gray-400 hover:bg-white/5 hover:text-white"
            aria-label="Dismiss"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-3">
          <div className="p-3 rounded-lg bg-black/40 border border-border">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Description
            </div>
            <div className="text-sm text-gray-200 font-mono break-words">
              {permission.description}
            </div>
          </div>

          {permission.reason && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle
                size={16}
                className="text-amber-400 flex-shrink-0 mt-0.5"
              />
              <div className="text-xs text-amber-200 leading-relaxed">
                {permission.reason}
              </div>
            </div>
          )}

          {permission.suggestedRule && (
            <div className="p-3 rounded-lg bg-white/[0.02] border border-border">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Always-allow rule (optional)
              </div>
              <input
                type="text"
                value={editedRule}
                onChange={(e) => setEditedRule(e.target.value)}
                placeholder="e.g. Bash(npm run test:*)"
                className="w-full px-2 py-1.5 rounded bg-black/40 border border-border text-sm font-mono text-gray-200 focus:outline-none focus:border-indigo-500"
              />
              <div className="text-xs text-gray-500 mt-1">
                Used only when you tap "Always allow". Edit to match the rule
                you want saved.
              </div>
            </div>
          )}

          {/* Args (collapsed preview) */}
          <details className="text-xs text-gray-400">
            <summary className="cursor-pointer hover:text-gray-300 select-none">
              Tool arguments
            </summary>
            <pre className="mt-2 p-2 rounded bg-black/40 border border-border overflow-x-auto text-xs font-mono text-gray-300">
              {JSON.stringify(permission.args, null, 2)}
            </pre>
          </details>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={dismiss}
            disabled={submitting !== null}
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            Deny
          </button>
          <button
            onClick={() => decide("allow-once")}
            disabled={submitting !== null}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/15 text-white disabled:opacity-50"
          >
            {submitting === "allow-once" ? "Allowing…" : "Allow once"}
          </button>
          <button
            onClick={() => decide("allow-session")}
            disabled={submitting !== null}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/15 text-white disabled:opacity-50"
          >
            Allow session
          </button>
          {permission.suggestedRule && (
            <button
              onClick={() => decide("allow-always")}
              disabled={submitting !== null}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-50"
            >
              {submitting === "allow-always" ? "Saving…" : "Always allow"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};