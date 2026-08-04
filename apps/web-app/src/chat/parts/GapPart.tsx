import React from "react";

interface GapPartProps {
  from: number;
  to: number;
}

/**
 * Renders a `stream_gap` (spec §4.2) — the server evicted events from
 * its ring buffer before this client reconnected, so some agent output
 * is permanently lost.
 *
 * This is deliberately loud. The whole point of the gap event is that a
 * silently-truncated transcript reads as complete but isn't: an invisible
 * gap makes the transcript quietly wrong, while a visible one tells the
 * reader to go check the desktop.
 */
export const GapPart: React.FC<GapPartProps> = ({ from, to }) => {
  const count = Math.max(0, to - from + 1);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        margin: "14px 0",
        padding: "10px 14px",
        borderRadius: "8px",
        background: "rgba(239, 68, 68, 0.06)",
        border: "1px dashed rgba(239, 68, 68, 0.35)",
        color: "rgba(252, 165, 165, 0.95)",
        fontSize: "13px",
        lineHeight: 1.5,
      }}
    >
      <span aria-hidden style={{ fontSize: "15px" }}>⚠</span>
      <span>
        Output lost while disconnected —{" "}
        {count > 0 ? `${count} event${count === 1 ? "" : "s"} ` : ""}
        could not be replayed. Check the desktop for the full transcript.
      </span>
    </div>
  );
};
