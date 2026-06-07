export default function LandingArtBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#202020] select-none"
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter
            id="veritas-grain"
            colorInterpolationFilters="sRGB"
            primitiveUnits="objectBoundingBox"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency=".713"
              numOctaves="4"
            />
            <feDisplacementMap
              in="SourceGraphic"
              scale=".1"
              xChannelSelector="R"
            />
            <feBlend in2="SourceGraphic" />
          </filter>

          <linearGradient id="veritas-bg-1" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#0b3145" />
            <stop offset=".28" stopColor="#12c7d4" />
            <stop offset=".55" stopColor="#b8a5ff" />
            <stop offset=".78" stopColor="#e5d86a" />
            <stop offset="1" stopColor="#8d3327" />
          </linearGradient>

          <linearGradient id="veritas-bg-2" x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#061a2d" />
            <stop offset=".35" stopColor="#2aa9ce" />
            <stop offset=".65" stopColor="#d2b4ff" />
            <stop offset="1" stopColor="#d78d3e" />
          </linearGradient>

          <linearGradient id="veritas-bg-3" x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#0f4f67" />
            <stop offset=".32" stopColor="#7de3f0" />
            <stop offset=".56" stopColor="#bca9f7" />
            <stop offset=".78" stopColor="#eee37d" />
            <stop offset="1" stopColor="#59291f" />
          </linearGradient>

          <radialGradient id="veritas-glow-blue" cx="50%" cy="50%" r="50%">
            <stop stopColor="#8cecff" />
            <stop offset=".55" stopColor="#4ea9e8" />
            <stop offset="1" stopColor="#102a6e" />
          </radialGradient>

          <radialGradient id="veritas-glow-yellow" cx="50%" cy="50%" r="50%">
            <stop stopColor="#fff58d" />
            <stop offset=".55" stopColor="#d6bb52" />
            <stop offset="1" stopColor="#7a3323" />
          </radialGradient>

          <radialGradient id="veritas-glow-violet" cx="50%" cy="50%" r="50%">
            <stop stopColor="#d8c8ff" />
            <stop offset=".6" stopColor="#8c77df" />
            <stop offset="1" stopColor="#2a286d" />
          </radialGradient>
        </defs>

        <g filter="url(#veritas-grain)">
          <rect width="1600" height="900" fill="#202020" />

          <rect width="1600" height="900" fill="url(#veritas-bg-1)" />

          <ellipse
            cx="250"
            cy="510"
            rx="520"
            ry="360"
            fill="url(#veritas-glow-blue)"
            opacity=".92"
            transform="rotate(-19 250 510)"
            style={{ filter: "blur(86px)" }}
          />

          <ellipse
            cx="690"
            cy="420"
            rx="560"
            ry="390"
            fill="url(#veritas-bg-2)"
            opacity=".88"
            transform="rotate(-8 690 420)"
            style={{ filter: "blur(92px)" }}
          />

          <ellipse
            cx="1130"
            cy="310"
            rx="500"
            ry="340"
            fill="url(#veritas-glow-yellow)"
            opacity=".82"
            transform="rotate(18 1130 310)"
            style={{ filter: "blur(96px)" }}
          />

          <circle
            cx="760"
            cy="510"
            r="300"
            fill="url(#veritas-glow-violet)"
            opacity=".78"
            style={{ filter: "blur(82px)" }}
          />

          <ellipse
            cx="1370"
            cy="565"
            rx="410"
            ry="320"
            fill="#743124"
            opacity=".72"
            transform="rotate(-25 1370 565)"
            style={{ filter: "blur(88px)" }}
          />

          <ellipse
            cx="440"
            cy="725"
            rx="540"
            ry="230"
            fill="url(#veritas-bg-3)"
            opacity=".48"
            transform="rotate(5 440 725)"
            style={{ filter: "blur(74px)" }}
          />

          <ellipse
            cx="1080"
            cy="690"
            rx="520"
            ry="220"
            fill="#2b2a68"
            opacity=".32"
            transform="rotate(-6 1080 690)"
            style={{ filter: "blur(72px)" }}
          />
        </g>

        <rect width="1600" height="900" fill="rgba(0,0,0,.10)" />
      </svg>

      {/* Soft readability wash only in the center, not a full white veil */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(255,255,255,0.76)_0%,rgba(255,255,255,0.54)_28%,rgba(255,255,255,0.18)_52%,rgba(255,255,255,0)_78%)]" />

      {/* Slight top/bottom polish so header/footer remain clean */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white/55 to-transparent" />
    </div>
  );
}