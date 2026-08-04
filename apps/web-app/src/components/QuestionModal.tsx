// =============================================================================
// QuestionModal — multi-choice prompt that the agent shows when it needs
// the user to pick one (or many) of a fixed set of options.
//
// Spec §4.4: a question arrives on the wire, the user picks, the answer
// is sent via question.answer RPC. If another device answered first the
// server returns -32002 (REQUEST_ALREADY_RESOLVED) — we surface that as
// state ("Already answered on another device") and close the modal,
// rather than treating it as a failure.
// =============================================================================

import React, { useState, useEffect } from "react";
import { X, HelpCircle } from "lucide-react";
import {
  useChatStore,
  type PendingQuestion,
} from "../stores/chat-store";
import { answerQuestion, rejectQuestion } from "../ipc-stub";

interface QuestionModalProps {
  question: PendingQuestion;
}

const ALREADY_RESOLVED_CODE = -32002;

export const QuestionModal: React.FC<QuestionModalProps> = ({ question }) => {
  const setPendingQuestion = useChatStore((s) => s.setPendingQuestion);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resolvedNotice, setResolvedNotice] = useState<
    "answered" | "rejected" | null
  >(null);

  // If the prompt was resolved by another device, surface the notice.
  useEffect(() => {
    if (question.resolved && resolvedNotice === null) {
      setResolvedNotice(question.resolved);
      // Auto-dismiss after a short delay so the user sees the message.
      const t = setTimeout(() => {
        setPendingQuestion(null);
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [question.resolved, resolvedNotice, setPendingQuestion]);

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

  if (question.questions.length === 0) return null;
  const q = question.questions[0]; // v1 only supports the first question.

  const isMulti = Boolean(q.multiple);

  function toggle(opt: string) {
    if (!isMulti) {
      setSelected([opt]);
      return;
    }
    setSelected((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt],
    );
  }

  async function submit() {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await answerQuestion(question.requestId, selected);
      // Success — close the modal. (The bus also publishes
      // question.answered which dismisses other devices, but for THIS
      // device the modal closes locally.)
      setPendingQuestion(null);
    } catch (err) {
      // -32002 = REQUEST_ALREADY_RESOLVED — another device won the race.
      // Render as state, not failure.
      const code = (err as { code?: number }).code;
      if (code === ALREADY_RESOLVED_CODE) {
        setResolvedNotice("answered");
      } else {
        // Some other failure — surface the error but don't close the
        // modal so the user can retry.
        setSubmitting(false);
        alert((err as Error).message || "Failed to submit answer");
      }
    }
  }

  async function dismiss() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await rejectQuestion(question.requestId);
      setPendingQuestion(null);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === ALREADY_RESOLVED_CODE) {
        setResolvedNotice("rejected");
      } else {
        setSubmitting(false);
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
            <HelpCircle
              size={20}
              className="text-indigo-400 flex-shrink-0 mt-0.5"
            />
            <div className="flex flex-col gap-1 min-w-0">
              <h2 className="text-base font-semibold text-white">
                {q.header || "Agent question"}
              </h2>
              <p className="text-sm text-gray-300 leading-relaxed">
                {q.question}
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

        {/* Options */}
        <div className="p-5 flex flex-col gap-2">
          {q.options.map((opt) => {
            const isSelected = selected.includes(opt.label);
            return (
              <button
                key={opt.label}
                onClick={() => toggle(opt.label)}
                disabled={submitting}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-500/10"
                    : "border-border bg-white/[0.02] hover:bg-white/5"
                } ${submitting ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 ${isMulti ? "rounded" : "rounded-full"} border-2 flex-shrink-0 ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-500"
                        : "border-gray-500"
                    }`}
                  >
                    {isSelected && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div
                          className={`bg-white ${isMulti ? "w-1.5 h-1.5 rounded-sm" : "w-1.5 h-1.5 rounded-full"}`}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="text-sm font-medium text-white">
                      {opt.label}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {opt.description}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={dismiss}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={submit}
            disabled={selected.length === 0 || submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : isMulti ? "Submit answers" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
};