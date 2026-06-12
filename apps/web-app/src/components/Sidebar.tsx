import React, { useState, useCallback, useEffect } from "react";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
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

  const sidebarClasses = `
    fixed inset-y-0 left-0 z-50 bg-bg-secondary border-r border-border p-5 flex flex-col transition-transform duration-300 ease-in-out
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
        <div className="h-10 border-b border-border pl-10" />

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
