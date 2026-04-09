import React, { useState, useEffect, useRef } from 'react';

interface LandingPageProps {
  onEnter: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnter }) => {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const enterTriggeredRef = useRef(false);

  const handleEnter = () => {
    // Prevent duplicate triggering from touch/pointer/click sequence.
    if (enterTriggeredRef.current) return;
    enterTriggeredRef.current = true;
    onEnter();
  };

  // Ambient particle background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const w = () => window.innerWidth;
    const h = () => window.innerHeight;

    // Particles
    const particles: { x: number; y: number; vx: number; vy: number; r: number; a: number; hue: number }[] = [];
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * w(),
        y: Math.random() * h(),
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: 1 + Math.random() * 2,
        a: 0.1 + Math.random() * 0.4,
        hue: 35 + Math.random() * 15,
      });
    }

    let time = 0;
    const animate = () => {
      time += 0.01;
      ctx.clearRect(0, 0, w(), h());

      // Radial gradient background
      const grad = ctx.createRadialGradient(w() / 2, h() / 2, 0, w() / 2, h() / 2, w() * 0.7);
      grad.addColorStop(0, '#111108');
      grad.addColorStop(0.5, '#0a0a06');
      grad.addColorStop(1, '#050504');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w(), h());

      // Subtle grid
      ctx.strokeStyle = 'rgba(139, 105, 20, 0.03)';
      ctx.lineWidth = 0.5;
      const gridSize = 60;
      for (let x = 0; x < w(); x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h());
        ctx.stroke();
      }
      for (let y = 0; y < h(); y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w(), y);
        ctx.stroke();
      }

      // Particles
      for (const p of particles) {
        p.x += p.vx + Math.sin(time + p.y * 0.01) * 0.15;
        p.y += p.vy + Math.cos(time + p.x * 0.01) * 0.15;

        if (p.x < 0) p.x = w();
        if (p.x > w()) p.x = 0;
        if (p.y < 0) p.y = h();
        if (p.y > h()) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 70%, 55%, ${p.a * (0.5 + Math.sin(time * 2 + p.x * 0.01) * 0.5)})`;
        ctx.fill();
      }

      // Connection lines
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(212, 165, 55, ${0.06 * (1 - dist / 120)})`;
            ctx.stroke();
          }
        }
      }

      // Central glow pulse
      const pulse = 0.5 + Math.sin(time * 0.8) * 0.15;
      const glow = ctx.createRadialGradient(w() / 2, h() * 0.42, 0, w() / 2, h() * 0.42, 300 * pulse);
      glow.addColorStop(0, `rgba(212, 165, 55, ${0.04 * pulse})`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w(), h());

      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden select-none">
      {/* Animated background */}
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6">

        {/* Logo mark */}
        <div className={`transition-all duration-1000 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="w-16 h-16 mx-auto mb-8 relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#D4A537] to-[#8B6914] opacity-20 blur-xl" />
            <div className="relative w-full h-full rounded-xl border border-[#8B6914]/40 bg-[#0a0a0a]/80 backdrop-blur flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M14 2L26 8V20L14 26L2 20V8L14 2Z" stroke="#D4A537" strokeWidth="1.5" fill="none" />
                <path d="M14 8L20 11V17L14 20L8 17V11L14 8Z" fill="#D4A537" fillOpacity="0.3" stroke="#D4A537" strokeWidth="1" />
                <circle cx="14" cy="14" r="2" fill="#D4A537" />
              </svg>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className={`transition-all duration-1000 delay-200 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <h1 className="text-center">
            <span className="block text-[11px] font-mono uppercase tracking-[0.5em] text-[#8B6914]/60 mb-3">elastic</span>
            <span className="block text-7xl md:text-8xl font-black tracking-tighter leading-none"
              style={{ fontFamily: "'Bebas Neue', sans-serif", color: '#D4A537' }}>
              PRISM PRO
            </span>
          </h1>
          <p className="text-center text-[11px] font-mono uppercase tracking-[0.35em] text-white/25 mt-4">
            Audio Visual Performance Suite
          </p>
        </div>

        {/* Feature pills */}
        <div className={`flex flex-wrap justify-center gap-2 mt-10 max-w-lg transition-all duration-1000 delay-500 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {['30 Visual Modes', 'GLSL Shaders', 'Three.js 3D', 'Beat Reactive', 'Text Engine', 'Hand Tracking'].map((f, i) => (
            <span key={i} className="px-3 py-1 rounded-full text-[9px] font-mono uppercase tracking-widest text-[#D4A537]/50 border border-[#8B6914]/20 bg-[#8B6914]/5">
              {f}
            </span>
          ))}
        </div>

        {/* CTA Button */}
        <div className={`mt-14 transition-all duration-1000 delay-700 ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <button
            type="button"
            onClick={handleEnter}
            onPointerUp={handleEnter}
            onTouchEnd={handleEnter}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleEnter();
              }
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="group relative px-12 py-4 cursor-pointer"
            aria-label="Launch Studio"
          >
            {/* Glow */}
            <div className={`absolute inset-0 rounded-xl bg-[#D4A537]/10 blur-xl transition-all duration-500 ${hovered ? 'scale-125 opacity-100' : 'scale-100 opacity-50'}`} />

            {/* Border */}
            <div className={`relative rounded-xl border transition-all duration-300 ${hovered ? 'border-[#D4A537]/60 bg-[#D4A537]/10' : 'border-[#8B6914]/30 bg-white/[0.02]'}`}>
              <div className="px-10 py-3.5 flex items-center gap-3">
                <span className={`text-[11px] font-bold uppercase tracking-[0.3em] transition-colors duration-300 ${hovered ? 'text-[#D4A537]' : 'text-white/50'}`}>
                  Launch Studio
                </span>
                <svg
                  className={`w-4 h-4 transition-all duration-300 ${hovered ? 'translate-x-1 text-[#D4A537]' : 'text-white/30'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>
            </div>
          </button>
        </div>

        {/* Keyboard hint */}
        <div className={`mt-6 transition-all duration-1000 delay-900 ${loaded ? 'opacity-100' : 'opacity-0'}`}>
          <p className="text-[9px] font-mono text-white/15 uppercase tracking-widest">
            Press <kbd className="px-1.5 py-0.5 rounded border border-white/10 text-white/25 mx-0.5">Enter</kbd> or <kbd className="px-1.5 py-0.5 rounded border border-white/10 text-white/25 mx-0.5">Space</kbd> to start
          </p>
        </div>

        {/* Bottom info */}
        <div className={`absolute bottom-6 left-0 right-0 flex justify-center gap-8 transition-all duration-1000 delay-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}>
          <span className="text-[8px] font-mono uppercase tracking-widest text-white/10">Browser Native</span>
          <span className="text-[8px] font-mono uppercase tracking-widest text-white/10">No Install</span>
          <span className="text-[8px] font-mono uppercase tracking-widest text-white/10">WebGL + Web Audio</span>
        </div>
      </div>
    </div>
  );
};
