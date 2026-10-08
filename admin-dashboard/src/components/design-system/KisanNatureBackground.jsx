import React from 'react';

/**
 * Reusable Subtle Nature Background Component for Kisan Vikas (Admin Dashboard).
 * Renders a very mild, government-grade agricultural landscape featuring
 * soft green hills, pale grass curves, and tiny seedling illustrations.
 * Positioned at the bottom of the viewport with pointer-events: none,
 * ensuring high readability on clean white content surfaces.
 */
export function KisanNatureBackground({ opacity = 0.20, style = {} }) {
  return (
    <div
      className="agriculture-background"
      aria-hidden="true"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        height: 'clamp(220px, 32vh, 320px)',
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
        opacity,
        ...style
      }}
    >
      <svg
        viewBox="0 0 1440 320"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <linearGradient id="kvHill1Admin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0" />
            <stop offset="45%" stopColor="#16a34a" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#15803d" stopOpacity="0.45" />
          </linearGradient>

          <linearGradient id="kvHill2Admin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0" />
            <stop offset="40%" stopColor="#22c55e" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0.55" />
          </linearGradient>

          <linearGradient id="kvHill3Admin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#86efac" stopOpacity="0" />
            <stop offset="35%" stopColor="#4ade80" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#15803d" stopOpacity="0.65" />
          </linearGradient>

          <linearGradient id="kvHill4Admin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bbf7d0" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#166534" stopOpacity="0.75" />
          </linearGradient>

          <pattern id="kvCropFurrowsAdmin" width="80" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(-4)">
            <line x1="0" y1="12" x2="80" y2="12" stroke="#15803d" strokeWidth="0.75" strokeOpacity="0.20" strokeDasharray="8 16" />
          </pattern>
        </defs>

        <path
          d="M0,105 C320,35 660,155 1020,65 C1240,15 1370,85 1440,60 L1440,320 L0,320 Z"
          fill="url(#kvHill1Admin)"
        />

        <path
          d="M0,160 C260,105 580,205 930,135 C1190,85 1360,165 1440,140 L1440,320 L0,320 Z"
          fill="url(#kvHill2Admin)"
        />

        <path
          d="M0,220 C340,175 710,245 1060,190 C1260,160 1380,210 1440,200 L1440,320 L0,320 Z"
          fill="url(#kvHill3Admin)"
        />

        <path
          d="M0,220 C340,175 710,245 1060,190 C1260,160 1380,210 1440,200 L1440,320 L0,320 Z"
          fill="url(#kvCropFurrowsAdmin)"
        />

        <path
          d="M0,265 C380,240 780,280 1180,250 C1320,240 1400,255 1440,250 L1440,320 L0,320 Z"
          fill="url(#kvHill4Admin)"
        />

        <g fill="#14532d" stroke="#14532d" strokeLinecap="round" strokeLinejoin="round">
          <path d="M130,152 Q130,134 132,122" strokeWidth="1.4" fill="none" />
          <path d="M132,132 C124,130 120,123 122,119 C126,119 131,125 132,132 Z" />
          <path d="M132,128 C139,126 143,120 141,116 C137,116 133,121 132,128 Z" />

          <path d="M310,172 Q309,153 308,140" strokeWidth="1.4" fill="none" />
          <path d="M309,152 C302,149 297,143 299,139 C303,139 308,145 309,152 Z" />
          <path d="M308,146 C316,144 320,137 318,133 C314,133 310,139 308,146 Z" />

          <path d="M510,195 Q512,170 514,153" strokeWidth="1.5" fill="none" />
          <path d="M513,174 C504,172 500,164 502,160 C506,160 512,166 513,174 Z" />
          <path d="M514,166 C523,163 527,156 525,152 C521,152 516,158 514,166 Z" />
          <path d="M514,157 C510,152 512,146 514,144 C516,146 518,152 514,157 Z" />

          <path d="M740,225 Q739,207 738,194" strokeWidth="1.4" fill="none" />
          <path d="M739,205 C732,203 727,196 729,192 C733,192 738,198 739,205 Z" />
          <path d="M738,200 C745,198 749,191 747,187 C743,187 740,193 738,200 Z" />

          <path d="M960,140 Q962,118 963,103" strokeWidth="1.5" fill="none" />
          <path d="M962,122 C954,120 949,113 952,109 C956,109 961,115 962,122 Z" />
          <path d="M963,115 C971,112 976,105 974,101 C970,101 965,107 963,115 Z" />
          <path d="M963,106 C960,101 962,96 963,94 C965,96 967,101 963,106 Z" />

          <path d="M1160,172 Q1159,153 1158,141" strokeWidth="1.4" fill="none" />
          <path d="M1159,153 C1152,150 1148,143 1150,140 C1154,140 1158,146 1159,153 Z" />
          <path d="M1158,147 C1166,145 1170,139 1168,135 C1164,135 1160,141 1158,147 Z" />

          <path d="M1350,190 Q1352,169 1353,156" strokeWidth="1.4" fill="none" />
          <path d="M1352,170 C1344,168 1341,161 1343,157 C1347,157 1351,163 1352,170 Z" />
          <path d="M1353,163 C1360,161 1365,155 1363,151 C1360,151 1355,157 1353,163 Z" />
        </g>
      </svg>
    </div>
  );
}

export default KisanNatureBackground;
