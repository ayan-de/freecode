import React from 'react';
import ASCIIText from './ASCIIText';

const footerLinks = [
  'Login',
  'Docs',
  'Security',
  'Changelog',
  'About',
  'Taste',
  'Teams',
  'Brand',
  'Pricing',
  'Careers',
  'Privacy',
  'Blog',
  'Community',
  'Skills',
  'Developers',
  'Models',
];

const hoverGradients = [
  'hover:bg-gradient-to-r hover:from-[#C7B8F5] hover:to-[#F3B5D2]',
  'hover:bg-gradient-to-l hover:from-[#F3B5D2] hover:to-[#AFCDF6]',
  'hover:bg-gradient-to-r hover:from-[#A7EADC] hover:to-[#F5B6A6]',
  'hover:bg-gradient-to-l hover:from-[#A7EADC] hover:to-[#C7B8F5]',
];

export function Footer() {
  return (
    <div className="relative w-full min-h-[40vh] overflow-hidden">
      {/* Grid - only 50% width, left aligned */}
      <div
        className="absolute inset-0 w-1/2"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gridTemplateRows: 'repeat(4, 1fr)',
        }}
      >
        {footerLinks.map((link, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const gradient = hoverGradients[i % hoverGradients.length];
          return (
            <div
              key={i}
              className={`border-r border-b border-white/20 flex items-center justify-center transition-colors duration-300 group ${gradient}`}
              style={{
                borderLeft: col === 0 ? '1px solid rgba(255,255,255,0.2)' : undefined,
                borderTop: row === 0 ? '1px solid rgba(255,255,255,0.2)' : undefined,
              }}
            >
              <a
                href={`/${link.toLowerCase()}`}
                className="text-white text-sm font-medium transition-colors group-hover:text-black group-hover:font-bold"
              >
                {link}
              </a>
            </div>
          );
        })}
      </div>

      {/* Logo on right 50% */}
      <div className="absolute inset-y-0 right-0 w-1/2 flex items-center justify-center">
        <ASCIIText
          text="FreeCode!"
          enableWaves
          asciiFontSize={5}
          textFontSize={50}
        />
      </div>
    </div>
  );
}