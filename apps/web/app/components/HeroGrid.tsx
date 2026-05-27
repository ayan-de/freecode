import React from 'react';

export function HeroGrid() {
  // A 12x8 grid for the background (added 1 row above and 1 below)
  const cells = Array.from({ length: 96 });

  return (
    <div className="relative w-full h-full min-h-full">
      {/* Grid with borders */}
      <div className="grid grid-cols-12 border-l border-t border-white/20 w-full h-full">
        {cells.map((_, i) => (
          <div key={i} className="aspect-square border-r border-b border-white/20" />
        ))}
      </div>

      {/* Noise filter SVG def */}
      <svg className="hidden">
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" stitchTiles="stitch"/>
          <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.15 0" />
        </filter>
      </svg>

      <div className="absolute inset-0 pointer-events-none">
        <style>{`
          .hero-block {
            position: absolute;
            background: linear-gradient(135deg, #4f46e5 0%, #1e1b4b 100%);
            border-radius: 2px;
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

        {/* Scattered blocks using % based on 12 cols (8.33% width per col) and 8 rows (12.5% height per row) */}
        {/* Blocks span 2 rows (25% height), positioned in middle rows 2-7 */}

        {/* Row 2-3 */}
        <div className="hero-block top-[12.5%] left-[83.33%] w-[8.33%] h-[25%]" />

        {/* Row 3-4 */}
        <div className="hero-block top-[25%] left-[66.66%] w-[8.33%] h-[25%]" />
        <div className="hero-block top-[25%] left-[83.33%] w-[16.66%] h-[25%]" />

        {/* Row 4-5 */}
        <div className="hero-block top-[37.5%] left-[75%] w-[8.33%] h-[25%]" />
        <div className="hero-block top-[37.5%] left-[91.66%] w-[8.33%] h-[25%]" />

        {/* Row 5-6 */}
        <div className="hero-block top-[50%] left-[58.33%] w-[16.66%] h-[25%]" />

        {/* Row 6-7 */}
        <div className="hero-block top-[62.5%] left-[75%] w-[16.66%] h-[25%]" />

        {/* Row 7-8 */}
        <div className="hero-block top-[75%] left-[50%] w-[8.33%] h-[25%]" />
        <div className="hero-block top-[75%] left-[66.66%] w-[16.66%] h-[25%]" />
      </div>
    </div>
  );
}
