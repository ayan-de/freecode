import React, { useState, useCallback, useEffect } from "react";
import { type SessionContext } from "../ipc-stub";
import { Clock, MessageSquare, Trash2, Plus } from "lucide-react";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionContext[];
  activeSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onNewConversation: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onNewConversation,
}) => {
  const [width, setWidth] = useState(288); // Default w-72 = 288px
  const [isDragging, setIsDragging] = useState(false);

  const minWidth = 200;
  const maxWidth = 400;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      // The mouse clientX corresponds to the new width from the left edge
      let newWidth = e.clientX;
      if (newWidth < minWidth) newWidth = minWidth;
      if (newWidth > maxWidth) newWidth = maxWidth;
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isDragging) setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, minWidth, maxWidth]);

  const handleDeleteSession = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      if (confirm("Delete this session?")) {
        onDeleteSession(sessionId);
      }
    },
    [onDeleteSession],
  );

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const sidebarClasses = `
    fixed inset-y-0 left-0 z-50 bg-black border-r border-border p-5 flex flex-col transition-transform duration-300 ease-in-out
    lg:relative lg:z-0 lg:flex
    ${isOpen ? "translate-x-0 lg:ml-0" : "-translate-x-full lg:hidden"}
  `;
  // Using inline style for dynamic width and to handle the hidden state translation cleanly
  const dynamicStyle = {
    width: `${width}px`,
    marginLeft: isOpen ? "0px" : `-${width}px`,
  };

  return (
    <>
      {/* Mobile Sidebar Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <div className={sidebarClasses} style={dynamicStyle}>
        {/* Header Spacer */}
        <div className="h-6 border-b border-border pl-10" />

        {/* New Conversation Button */}
        <div className="px-2 pt-4 pb-2">
          <button
            onClick={onNewConversation}
            className="flex items-center justify-center gap-2 w-full py-2 px-4 rounded-sm border border-border bg-white/5 hover:bg-white/10 text-gray-200 hover:text-white font-medium text-sm transition-all active:scale-95 group"
          >
            <Plus
              size={16}
              className="text-gray-400 group-hover:text-white transition-colors"
            />
            <span>New Conversation</span>
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto mt-2">
          <div className="px-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-2">
              Previous Sessions
            </h3>
            {sessions.length === 0 ? (
              <div className="text-sm text-gray-500 px-2 py-4 text-center">
                No sessions yet
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => onSelectSession(session.id)}
                    className={`w-full text-left px-2 py-2 rounded hover:bg-white/5 transition-colors group relative ${
                      session.id === activeSessionId ? "bg-white/10" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm text-gray-200 truncate">
                        {session.title || "Untitled Session"}
                      </div>
                      <button
                        onClick={(e) => handleDeleteSession(e, session.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-gray-500 transition-opacity flex-shrink-0"
                        title="Delete session"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                      <span className="flex items-center gap-1">
                        <MessageSquare size={10} />
                        {session.turnCount} turns
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {formatRelativeTime(session.lastTurnAt)}
                      </span>
                    </div>
                    {session.status === "interrupted" && (
                      <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500">
                        Interrupted
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Drag Handle */}
        <div
          onMouseDown={handleMouseDown}
          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500/50 transition-colors z-50 ${
            isDragging ? "bg-indigo-500" : "bg-transparent"
          }`}
          style={{ transform: "translateX(50%)" }}
        />
      </div>
    </>
  );
};
