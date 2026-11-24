// A pen-sketch skyline that runs from San Francisco (left) into Washington (right). Decorative only.
// The middle fades out, so one city dissolves into the other.
export default function Skyline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 640 90" preserveAspectRatio="xMinYMax meet" aria-hidden focusable="false">
      <defs>
        <linearGradient id="sky-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.36" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.64" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="sky-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="90">
          <rect width="640" height="90" fill="url(#sky-fade)" />
        </mask>
      </defs>
      <g mask="url(#sky-mask)" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* San Francisco: Golden Gate Bridge */}
        <path pathLength={1} d="M18 88 V24 M34 88 V24 M16 24 H36 M18 36 H34 M18 50 H34 M18 64 H34" />
        <path pathLength={1} d="M0 70 H120" />
        <path pathLength={1} d="M2 40 Q12 52 18 26 M34 26 Q70 78 118 70" />
        <path pathLength={1} d="M44 70 V48 M56 70 V58 M68 70 V64 M84 70 V66" strokeWidth="1" />
        {/* Low city blocks */}
        <path pathLength={1} d="M124 88 V60 H138 V88 M140 88 V50 H152 V88" />
        {/* Transamerica Pyramid */}
        <path pathLength={1} d="M156 88 L170 14 L184 88 M170 14 V4 M163 52 H156 V58 M177 52 H184 V58" />
        {/* Salesforce Tower */}
        <path pathLength={1} d="M194 88 V30 Q204 14 214 30 V88 M199 36 V86 M209 36 V86" strokeWidth="1.4" />
        <path pathLength={1} d="M218 88 V44 H232 V88 M234 88 V58 H248 V88 M250 88 V66 H262 V88" />
        {/* Between the coasts */}
        <path pathLength={1} d="M266 88 V72 H280 V88 M286 88 V76 H300 V88 M306 88 V70 H318 V88 M324 88 V78 H340 V88 M346 88 V74 H358 V88" />
        {/* Washington: the Monument */}
        <path pathLength={1} d="M384 88 V20 L390 10 L396 20 V88" />
        <path pathLength={1} d="M404 88 V74 H418 V88" />
        {/* The Capitol */}
        <path pathLength={1} d="M426 88 V66 H534 V88 M426 66 L432 60 H528 L534 66" />
        <path pathLength={1} d="M434 88 V70 M442 88 V70 M518 88 V70 M526 88 V70" strokeWidth="1" />
        <path pathLength={1} d="M456 60 V48 H504 V60 M462 60 V50 M470 60 V50 M478 60 V50 M486 60 V50 M494 60 V50 M500 60 V50" strokeWidth="1" />
        <path pathLength={1} d="M458 48 Q480 12 502 48" />
        <path pathLength={1} d="M474 25 V18 H486 V25 M480 18 V10 M478 12 H482" />
        {/* Lincoln Memorial */}
        <path pathLength={1} d="M554 88 V68 H616 V88 M550 68 H620 L616 62 H554 Z M560 68 V86 M570 68 V86 M580 68 V86 M590 68 V86 M600 68 V86 M610 68 V86" strokeWidth="1.3" />
        {/* Ground */}
        <path pathLength={1} d="M0 88 H640" strokeWidth="1.2" />
      </g>
    </svg>
  );
}
