import React from 'react';

export function HeroGrid() {
  const cells = Array.from({ length: 96 });

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Hero decorative blocks */}
      <div className="absolute inset-0 pointer-events-none">
        <style>{`
          .hero-block {
            position: absolute;
            background: linear-gradient(135deg, #4f46e5 0%, #1e1b4b 100%);
            overflow: hidden;
          }
          .hero-block::before {
            content: "";
            position: absolute;
            inset: 0;
            opacity: 0.4;
            mix-blend-mode: overlay;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          }
        `}</style>

        <div className="hero-block top-[12.5%] left-[83.33%] w-[8.33%] h-[25%]" />
        <div className="hero-block top-[25%] left-[66.66%] w-[8.33%] h-[25%]" />
        <div className="hero-block top-[25%] left-[83.33%] w-[16.66%] h-[25%]" />
        <div className="hero-block top-[37.5%] left-[75%] w-[8.33%] h-[25%]" />
        <div className="hero-block top-[37.5%] left-[91.66%] w-[8.33%] h-[25%]" />
        <div className="hero-block top-[50%] left-[58.33%] w-[16.66%] h-[25%]" />
        <div className="hero-block top-[62.5%] left-[75%] w-[16.66%] h-[25%]" />
        <div className="hero-block top-[75%] left-[50%] w-[8.33%] h-[25%]" />
        <div className="hero-block top-[75%] left-[66.66%] w-[16.66%] h-[25%]" />
      </div>

      {/* Grid */}
      <div
        className="w-full h-full relative z-10"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gridTemplateRows: 'repeat(8, 1fr)',
        }}
      >
        {cells.map((_, i) => {
          const col = i % 12;
          const row = Math.floor(i / 12);
          return (
            <div
              key={i}
              className="border-r border-b border-white/20"
              style={{
                borderLeft: col === 0 ? '1px solid rgba(255,255,255,0.4)' : undefined,
                borderTop: row === 0 ? '1px solid rgba(255,255,255,0.4)' : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}