interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

const offset = "max(80px, calc((100vw - 1024px) / 2))";

export function PageWrapper({ children, className = "" }: PageWrapperProps) {
  return (
    <div
      className={`relative min-h-screen bg-background text-foreground transition-colors duration-300 ${className}`}
    >
      <div
        className="fixed top-0 bottom-0 left-[max(80px,calc((100vw-1024px)/2))] w-px bg-border z-50 pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="fixed top-0 bottom-0 right-[max(80px,calc((100vw-1024px)/2))] w-px bg-border z-50 pointer-events-none"
        aria-hidden="true"
      />
      {children}
    </div>
  );
}
