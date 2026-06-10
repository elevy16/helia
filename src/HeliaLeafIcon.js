import React from 'react';

export default function HeliaLeafIcon({ size, height = 28, color = '#2d5a27' }) {
  const svgHeight = size ? Math.round(size * 1.19) : height;
  const svgWidth = size || Math.round(height / 1.19);
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox="0 0 48 58"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path fill={color} d="M24 2 Q42 24 24 54 Q6 24 24 2 Z" />
    </svg>
  );
}
