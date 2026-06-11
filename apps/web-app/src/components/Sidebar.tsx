import React from "react";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const sidebarClasses = `
    fixed inset-y-0 left-0 z-50 w-72 bg-bg-secondary border-r border-border p-5 flex flex-col transition-all duration-300 ease-in-out
    lg:relative lg:z-0 lg:w-80 lg:flex
    ${isOpen ? "translate-x-0 lg:ml-0" : "-translate-x-full lg:-ml-80"}
  `;

  return (
    <>
      {/* Mobile Sidebar Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <div className={sidebarClasses}>
        {/* Header Spacer */}
        <div className="h-5 border-b border-border pl-10" />
      </div>
    </>
  );
};
