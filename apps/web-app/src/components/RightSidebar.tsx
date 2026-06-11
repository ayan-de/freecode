import React from "react";

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ isOpen, onClose }) => {
  const sidebarClasses = `
    fixed inset-y-0 right-0 z-50 w-72 bg-bg-secondary border-l border-border p-5 flex flex-col transition-all duration-300 ease-in-out
    lg:relative lg:z-0 lg:flex
    ${isOpen ? "translate-x-0 lg:mr-0" : "translate-x-full lg:-mr-72"}
  `;

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={sidebarClasses}>
        {/* Header Spacer */}
        <div className="h-5 border-b border-border pr-10" />
      </aside>
    </>
  );
};
