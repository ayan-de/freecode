import React from "react";

export function BackgroundGrid() {
  return (
    <g opacity="0.05">
      <path
        d="M 0,50 L 1000,50 M 0,100 L 1000,100 M 0,150 L 1000,150 M 0,200 L 1000,200 M 0,250 L 1000,250 M 0,300 L 1000,300 M 0,350 L 1000,350 M 0,400 L 1000,400 M 0,450 L 1000,450 M 0,500 L 1000,500 M 0,550 L 1000,550 M 0,600 L 1000,600"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="0.5"
      />
      <path
        d="M 100,0 L 100,650 M 200,0 L 200,650 M 300,0 L 300,650 M 400,0 L 400,650 M 500,0 L 500,650 M 600,0 L 600,650 M 700,0 L 700,650 M 800,0 L 800,650 M 900,0 L 900,650"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="0.5"
      />
    </g>
  );
}
