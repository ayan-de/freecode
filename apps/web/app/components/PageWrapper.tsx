interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

const offset = "max(80px, calc((100vw - 1280px) / 2))";

export function PageWrapper({ children, className = "" }: PageWrapperProps) {
  return (
    <div
      className={`relative min-h-screen bg-gradient-to-br from-black via-[#0a0a0a] to-[#1a1a2e] ${className}`}
    >
      <div
        className="fixed top-0 bottom-0 left-[max(80px,calc((100vw-1280px)/2))] w-px bg-white/15 z-50 pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="fixed top-0 bottom-0 right-[max(80px,calc((100vw-1280px)/2))] w-px bg-white/15 z-50 pointer-events-none"
        aria-hidden="true"
      />
      {children}
    </div>
  );
}