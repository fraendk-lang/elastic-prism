import React, { useRef, useEffect } from 'react';
import { VisualizerSettings } from '../types';

interface FluidParticlesProps {
  getFrequencyData: () => Uint8Array;
  settings: VisualizerSettings;
}

// Pre-allocated particle pool (no runtime allocation)
const MAX_PARTICLES = 200;
const pool = new Float32Array(MAX_PARTICLES * 7); // x, y, vx, vy, life, maxLife, size
let poolCount = 0;

function noise2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

export const FluidParticles: React.FC<FluidParticlesProps> = ({ getFrequencyData, settings }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const getFreqRef = useRef(getFrequencyData);
  getFreqRef.current = getFrequencyData;
  const kickPrev = useRef(0);
  const kickE = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const dpr = Math.min(window.devicePixelRatio, 2);
        canvas.width = parent.clientWidth * dpr;
        canvas.height = parent.clientHeight * dpr;
        ctx.scale(dpr, dpr);
      }
    };
    window.addEventListener('resize', resize);
    resize();

    poolCount = 0; // Reset pool

    const render = () => {
      if (!canvas || !ctx) return;
      const s = settingsRef.current;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const time = Date.now() * 0.001;

      ctx.clearRect(0, 0, w, h);

      const freqData = getFreqRef.current();
      let bass = 0;
      if (freqData.length > 10) for (let i = 0; i < 10; i++) bass += freqData[i];
      bass /= 2550;

      // Kick detection
      const kd = bass - kickPrev.current;
      kickPrev.current = bass;
      if (kd > 0.06) kickE.current = Math.min(1, kd * 6);
      kickE.current *= 0.82;

      const maxCount = Math.min(s.fluidParticleCount, MAX_PARTICLES);

      // Spawn (reuse dead slots)
      const spawnRate = Math.min(3, Math.floor(1 + bass * 3 + kickE.current * 5));
      for (let sp = 0; sp < spawnRate && poolCount < maxCount; sp++) {
        const idx = poolCount * 7;
        const burst = kickE.current > 0.3;
        pool[idx]     = burst ? w * 0.5 + (Math.random() - 0.5) * w * 0.2 : Math.random() * w; // x
        pool[idx + 1] = burst ? h * 0.5 + (Math.random() - 0.5) * h * 0.2 : Math.random() * h; // y
        pool[idx + 2] = (Math.random() - 0.5) * (burst ? 3 : 0.5); // vx
        pool[idx + 3] = (Math.random() - 0.5) * (burst ? 3 : 0.5) - 0.5; // vy
        pool[idx + 4] = 0; // life
        pool[idx + 5] = 60 + Math.random() * 100; // maxLife
        pool[idx + 6] = 1 + Math.random() * 2; // size
        poolCount++;
      }

      // Update & draw (single color, no per-particle gradient)
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = s.colorPrimary;

      let writeIdx = 0;
      for (let i = 0; i < poolCount; i++) {
        const idx = i * 7;
        pool[idx + 4]++; // life++

        if (pool[idx + 4] >= pool[idx + 5]) continue; // dead

        // Curl noise
        const nx = pool[idx] * 0.003;
        const ny = pool[idx + 1] * 0.003;
        const cx = noise2D(nx, ny + time * 0.3) * 0.3;
        const cy = noise2D(nx + time * 0.3, ny) * 0.3;

        pool[idx + 2] = (pool[idx + 2] + cx) * 0.97; // vx
        pool[idx + 3] = (pool[idx + 3] + cy - bass * 0.2) * 0.97; // vy

        pool[idx]     += pool[idx + 2] * s.speed; // x
        pool[idx + 1] += pool[idx + 3] * s.speed; // y

        // Wrap
        if (pool[idx] < 0) pool[idx] += w;
        if (pool[idx] > w) pool[idx] -= w;
        if (pool[idx + 1] < 0) pool[idx + 1] += h;
        if (pool[idx + 1] > h) pool[idx + 1] -= h;

        const lifeRatio = pool[idx + 4] / pool[idx + 5];
        const alpha = lifeRatio < 0.1 ? lifeRatio * 10 : lifeRatio > 0.7 ? (1 - lifeRatio) / 0.3 : 1;
        const r = pool[idx + 6] * s.fluidParticleSize * (1 + bass * 0.3);

        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.arc(pool[idx], pool[idx + 1], r, 0, Math.PI * 2);
        ctx.fill();

        // Compact live particles
        if (writeIdx !== i) {
          const wIdx = writeIdx * 7;
          for (let k = 0; k < 7; k++) pool[wIdx + k] = pool[idx + k];
        }
        writeIdx++;
      }
      poolCount = writeIdx;

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      animRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block" style={{ touchAction: 'none' }} />;
};
