export default function LandingArtBackground() {
  return (
    <div
      className="absolute inset-0 w-full h-full pointer-events-none select-none z-0 overflow-hidden bg-[#FCFBFA]"
      aria-hidden="true"
    >
      {/* GPU-accelerated glowing ambient gradient anchors for buttery smooth, top-quality rendering */}
      
      {/* Top-Left Major Navy Anchor: deep, academic signature */}
      <div className="absolute -top-[15%] -left-[10%] w-[55vw] h-[55vw] min-w-[320px] rounded-full bg-gradient-to-tr from-[#0B2342] to-[#143152] opacity-[0.11] blur-[100px] md:blur-[150px] transition-transform duration-700" />

      {/* Auxiliary Mid-Left Deep Anchor Balance */}
      <div className="absolute top-[10%] left-[5%] w-[35vw] h-[35vw] min-w-[220px] rounded-full bg-[#0F294A] opacity-[0.06] blur-[90px] md:blur-[130px]" />

      {/* Top-Right Royal Academic Blue Support */}
      <div className="absolute -top-[10%] right-[5%] w-[40vw] h-[40vw] min-w-[260px] rounded-full bg-[#3B82F6] opacity-[0.045] blur-[80px] md:blur-[120px]" />

      {/* Bottom-Right Golden/Amber Glow: warm, premium contrast near student portal inputs */}
      <div className="absolute -bottom-[15%] -right-[10%] w-[60vw] h-[60vw] min-w-[350px] rounded-full bg-gradient-to-br from-[#ECC25E] to-[#E5B53B] opacity-[0.13] blur-[110px] md:blur-[160px]" />

      {/* Mid-Right Gold Connection */}
      <div className="absolute bottom-[25%] right-[5%] w-[32vw] h-[32vw] min-w-[200px] rounded-full bg-[#ECC25E] opacity-[0.05] blur-[70px] md:blur-[110px]" />

      {/* Bottom-Left Academic Soft Slate-Glow */}
      <div className="absolute -bottom-[5%] left-[2%] w-[45vw] h-[45vw] min-w-[280px] rounded-full bg-gradient-to-bl from-[#8397B0] to-[#A4B7CE] opacity-[0.08] blur-[90px] md:blur-[140px]" />

      {/* Center ambient connector */}
      <div className="absolute top-[35%] left-[30%] w-[25vw] h-[25vw] rounded-full bg-[#8397B0] opacity-[0.03] blur-[80px] md:blur-[110px]" />

      {/* Infinite high-definition fine vector grain texture layer at native 1:1 screen resolution */}
      <svg
        width="100%"
        height="100%"
        className="absolute inset-0 w-full h-full opacity-[0.042] mix-blend-overlay"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="premium-grain-filter" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.78"
              numOctaves="3"
              result="noise"
            />
            {/* Soften contrast of monochromatic noise to make it feel premium, like textured paper */}
            <feColorMatrix
              type="matrix"
              values="0.33 0.33 0.33 0 0
                      0.33 0.33 0.33 0 0
                      0.33 0.33 0.33 0 0
                      0 0 0 0.85 0"
              in="noise"
            />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#premium-grain-filter)" />
      </svg>

      {/* Micro-textured background noise fallback to prevent extreme banding on older 8-bit monitor channels */}
      <div className="absolute inset-0 bg-white/5 backdrop-blur-[1px]" />
    </div>
  );
}
