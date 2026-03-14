// Hockey-themed SVG decorations for Tilt Corporate Headquarters

export function HockeyStickIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21l9-9" />
      <path d="M12 12l5-5c1-1 2.5-1 3 0s0 2-1 3l-5 5" />
      <path d="M3 21h4l8-8" />
    </svg>
  );
}

export function PuckIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="12" cy="14" rx="8" ry="3" />
      <ellipse cx="12" cy="10" rx="8" ry="3" />
      <line x1="4" y1="10" x2="4" y2="14" />
      <line x1="20" y1="10" x2="20" y2="14" />
    </svg>
  );
}

export function CrossedSticksIcon({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      {/* Left stick */}
      <path d="M6 26l12-12" />
      <path d="M18 14l3-3c1-1 1-2.5 0-3s-2 0-3 1l-3 3" />
      <path d="M6 26h3l9-9" />
      {/* Right stick */}
      <path d="M26 26l-12-12" />
      <path d="M14 14l-3-3c-1-1-1-2.5 0-3s2 0 3 1l3 3" />
      <path d="M26 26h-3l-9-9" />
    </svg>
  );
}

export function IceRinkPattern() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-[0.03]">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        {/* Center line */}
        <line x1="50%" y1="0" x2="50%" y2="100%" stroke="#e4002b" strokeWidth="2" />
        {/* Center circle */}
        <circle cx="50%" cy="50%" r="80" fill="none" stroke="#e4002b" strokeWidth="1.5" />
        {/* Blue lines */}
        <line x1="33%" y1="0" x2="33%" y2="100%" stroke="#0066cc" strokeWidth="1.5" />
        <line x1="67%" y1="0" x2="67%" y2="100%" stroke="#0066cc" strokeWidth="1.5" />
        {/* Face-off circles */}
        <circle cx="25%" cy="30%" r="40" fill="none" stroke="#e4002b" strokeWidth="1" />
        <circle cx="75%" cy="30%" r="40" fill="none" stroke="#e4002b" strokeWidth="1" />
        <circle cx="25%" cy="70%" r="40" fill="none" stroke="#e4002b" strokeWidth="1" />
        <circle cx="75%" cy="70%" r="40" fill="none" stroke="#e4002b" strokeWidth="1" />
      </svg>
    </div>
  );
}

export function CarbonFiberBg() {
  return (
    <div className="absolute inset-0 pointer-events-none carbon-texture opacity-50" />
  );
}

export function StickSilhouette({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`absolute pointer-events-none opacity-[0.04] ${className}`}
      viewBox="0 0 200 600"
      fill="currentColor"
      width="200"
      height="600"
    >
      {/* Shaft */}
      <rect x="95" y="0" width="10" height="480" rx="3" />
      {/* Blade */}
      <path d="M95 480 Q95 520 60 540 Q30 555 20 570 Q15 580 25 585 Q60 590 100 560 Q105 555 105 480 Z" />
    </svg>
  );
}
