import React, { useState, useCallback, useEffect } from "react";

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen,
  onClose,
}) => {
  const [width, setWidth] = useState(288); // Default 288px
  const [isDragging, setIsDragging] = useState(false);

  const minWidth = 200;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      // The mouse clientX from the right edge determines width
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth < minWidth) newWidth = minWidth;
      // Allow it to drag to the whole screen (leave a tiny gap for the left edge)
      const maxWidth = window.innerWidth - 50;
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
  }, [isDragging, minWidth]);

  const sidebarClasses = `
    fixed inset-y-0 right-0 z-50 bg-bg-secondary border-l border-border p-5 flex flex-col transition-transform duration-300 ease-in-out
    lg:relative lg:z-0 lg:flex
    ${isOpen ? "translate-x-0 lg:mr-0" : "translate-x-full lg:hidden"}
  `;
  const dynamicStyle = {
    width: `${width}px`,
    marginRight: isOpen ? "0px" : `-${width}px`,
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={sidebarClasses} style={dynamicStyle}>
        {/* Header Spacer */}
        <div className="h-10 border-b border-border pr-10" />

        {/* Drag Handle */}
        <div
          onMouseDown={handleMouseDown}
          className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500/50 transition-colors z-50 ${
            isDragging ? "bg-indigo-500" : "bg-transparent"
          }`}
          style={{ transform: "translateX(-50%)" }}
        />
      </aside>
    </>
  );
};
