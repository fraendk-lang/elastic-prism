import React, { useRef, useEffect } from 'react';
import { VisualizerSettings, HandUpdate } from '../types';

// Chrome does software shadow blur (VERY slow >15px). Safari uses GPU. Cap for cross-browser perf.
const MAX_SHADOW = 15;
const safeBlur = (v: number) => Math.min(MAX_SHADOW, v);

// Zero-alloc audio analysis helpers (avoid .slice().reduce() which creates arrays every frame)
const avgRange = (data: Uint8Array, from: number, to: number): number => {
  if (data.length <= from) return 0;
  const end = Math.min(to, data.length);
  let sum = 0;
  for (let i = from; i < end; i++) sum += data[i];
  return sum / ((end - from) * 255);
};

interface VisualizerCanvasProps {
  getFrequencyData: () => Uint8Array;
  getTimeDomainData: () => Uint8Array;
  settings: VisualizerSettings;
  mousePosRef: React.RefObject<{ x: number; y: number }>;
  handPosRef: React.RefObject<HandUpdate | null>;
  engineOverrides?: React.MutableRefObject<Partial<VisualizerSettings>>;
}

export const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  getFrequencyData,
  getTimeDomainData,
  settings,
  mousePosRef,
  handPosRef,
  engineOverrides,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const kickPrev = useRef(0);
  const kickEnergy = useRef(0);
  const snarePrev = useRef(0);
  const snareEnergy = useRef(0);
  const starDataRef = useRef<{ x: number; y: number; z: number; seed: number }[] | null>(null);
  const lissajousTrailRef = useRef<{ x: number; y: number }[]>([]);
  // Pre-allocated idle data (avoids GC pressure from per-frame allocation)
  const idleFreqRef = useRef(new Uint8Array(1024));
  const idleTimeRef = useRef(new Uint8Array(1024));

  // Store props in refs so the render loop always reads latest values without re-mounting
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const getFreqRef = useRef(getFrequencyData);
  getFreqRef.current = getFrequencyData;
  const getTimeRef = useRef(getTimeDomainData);
  getTimeRef.current = getTimeDomainData;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    const offscreenCanvas = document.createElement('canvas');
    const octx = offscreenCanvas.getContext('2d');

    // Chrome's 2D canvas is ~4x slower than Safari at Retina res (SW shadow, SW compositing).
    // Detect Chrome and cap DPR at 1 for smooth 60fps. Safari handles 2x fine via GPU.
    const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
    const DPR = isChrome ? 1 : Math.min(window.devicePixelRatio, 2);
    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const w = parent.clientWidth * DPR;
        const h = parent.clientHeight * DPR;
        canvas.width = w;
        canvas.height = h;
        offscreenCanvas.width = w;
        offscreenCanvas.height = h;
        ctx.scale(DPR, DPR);
        if (octx) octx.scale(DPR, DPR);
      }
    };

    window.addEventListener('resize', resize);
    resize();

    // Pause rendering when tab is hidden (saves CPU/GPU)
    let paused = false;
    const handleVisibility = () => { paused = document.hidden; };
    document.addEventListener('visibilitychange', handleVisibility);

    const render = () => {
      try {
        if (!canvas || !ctx) return;
        if (paused) { animationRef.current = requestAnimationFrame(render); return; }

        // Read latest values from refs each frame (no useEffect re-mount needed)
        // Merge engine overrides (harmonic color, transition morph, automation)
        const settings = engineOverrides?.current
          ? { ...settingsRef.current, ...engineOverrides.current } as VisualizerSettings
          : settingsRef.current;
        const mousePos = mousePosRef.current;
        const handPos = handPosRef.current;

        const width = canvas.width / DPR;
        const height = canvas.height / DPR;

        if (width <= 0 || height <= 0) {
          animationRef.current = requestAnimationFrame(render);
          return;
        }

        let freqData = getFreqRef.current();
        let timeData = getTimeRef.current();

        // Check if audio is silent (all values near zero)
        let totalEnergy = 0;
        if (freqData && freqData.length > 0) {
          for (let i = 0; i < Math.min(freqData.length, 64); i++) totalEnergy += freqData[i];
        }
        const isSilent = !freqData || freqData.length === 0 || totalEnergy < 10;

        // Generate synthetic idle data when no audio (reuse pre-allocated arrays)
        if (isSilent) {
          const t = Date.now() * 0.001;
          const iF = idleFreqRef.current;
          const iT = idleTimeRef.current;
          const breath = Math.sin(t * 0.5) * 0.3 + 0.3;
          // Only update every 4th sample for speed
          for (let i = 0; i < 1024; i += 4) {
            const n = i * 0.0009765625; // 1/1024
            const val = ((breath + Math.sin(n * 12.56 + t * 2) * 0.2) * (1 - n * 0.7)) * 255;
            iF[i] = iF[i+1] = iF[i+2] = iF[i+3] = Math.max(0, val) | 0;
            const tv = 128 + Math.sin(n * 6.28 + t * 1.5) * 30 * breath;
            iT[i] = iT[i+1] = iT[i+2] = iT[i+3] = tv | 0;
          }
          freqData = iF;
          timeData = iT;
        }

        // Apply Hue Rotation and Color Cycle
        const time = Date.now() * 0.001;
        const cycleHue = settings.colorCycleSpeed > 0 ? (time * settings.colorCycleSpeed * 360) % 360 : 0;
        const totalHue = (settings.hueRotation + cycleHue) % 360;
        
        if (totalHue !== 0) {
          ctx.filter = `hue-rotate(${totalHue}deg)`;
        } else {
          ctx.filter = 'none';
        }

        // Audio analysis for club-grade reactivity (no .slice() — zero alloc)
        let bassSum = 0;
        if (freqData.length > 0) { const bEnd = Math.min(10, freqData.length); for (let i = 0; i < bEnd; i++) bassSum += freqData[i]; bassSum /= bEnd; }
        let midSum = 0;
        if (freqData.length > 100) { for (let i = 30; i < 100; i++) midSum += freqData[i]; midSum /= 70; }
        let rmsAcc = 0;
        if (timeData.length > 0) { for (let i = 0; i < timeData.length; i++) { const d = timeData[i] - 128; rmsAcc += d * d; } }
        const rms = timeData.length > 0 ? Math.sqrt(rmsAcc / timeData.length) / 128 : 0;
        const bassNorm = bassSum / 255;
        const midNorm = midSum / 255;

        // Kick & snare transient detection for punchy visuals
        const kickDelta = bassNorm - (kickPrev.current || 0);
        kickPrev.current = bassNorm;
        if (kickDelta > 0.06) kickEnergy.current = Math.min(1, kickDelta * 6);
        kickEnergy.current *= 0.82; // fast decay

        const snareDelta = midNorm - (snarePrev.current || 0);
        snarePrev.current = midNorm;
        if (snareDelta > 0.04) snareEnergy.current = Math.min(1, snareDelta * 7);
        snareEnergy.current *= 0.85;

        // Beat Sync Logic - aggressive for club visuals
        const beatMultiplier = settings.beatSync ? (1 + bassNorm * 1.2 + kickEnergy.current * 2) : 1;
        const pulse = Math.min(10, (Math.pow(bassNorm, 1.5) * 2 + kickEnergy.current * 3) * (settings.masterIntensity || 1));
        const reactiveGlitch = settings.glitch ? (rms > 0.2 ? 0.9 : 0.15) * (settings.masterIntensity || 1) * beatMultiplier * settings.glitchIntensity : 0;
        const reactiveBloom = settings.bloom ? (0.3 + rms * 0.7 + kickEnergy.current * 0.5) * (settings.masterIntensity || 1) * beatMultiplier * settings.bloomRadius : 0;

        // CRITICAL: reset shadow state BEFORE any draw ops (shadow leaks from previous frame destroy Chrome perf)
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        // Always start with black background for deep contrast
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        // Subtle background pulse (very dim, never washes out)
        if (pulse > 0.1 && !settings.feedback) {
          ctx.save();
          ctx.globalAlpha = Math.min(0.08, pulse * 0.04);
          ctx.fillStyle = settings.colorPrimary;
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        }

        const drawMode = (targetCtx: CanvasRenderingContext2D, mode: any, isSecondary: boolean) => {
        targetCtx.save();
        
        // Hand position overrides mouse if active and gesture control is on
        const activeX = (settings.gestureControl && handPos?.active) ? handPos.x : mousePos.x;
        const activeY = (settings.gestureControl && handPos?.active) ? handPos.y : mousePos.y;
        const isActive = (settings.gestureControl && handPos?.active) || settings.mouseInteraction;

        const currentMouse = {
          x: activeX * width,
          y: activeY * height,
          active: isActive
        };

        // Draw hand position indicator if active
        if (settings.gestureControl && handPos?.active) {
          targetCtx.save();
          targetCtx.beginPath();
          const gradient = targetCtx.createRadialGradient(
            currentMouse.x, currentMouse.y, 0,
            currentMouse.x, currentMouse.y, 20
          );
          gradient.addColorStop(0, `${settings.colorPrimary}66`);
          gradient.addColorStop(1, 'transparent');
          targetCtx.fillStyle = gradient;
          targetCtx.arc(currentMouse.x, currentMouse.y, 20, 0, Math.PI * 2);
          targetCtx.fill();
          targetCtx.restore();
        }

        if (settings.mirror) {
          targetCtx.save();
          targetCtx.translate(width / 2, 0);
          targetCtx.scale(-1, 1);
          targetCtx.translate(-width / 2, 0);
          
          switch (mode) {
            case 'bars': drawBars(targetCtx, freqData, width, height, settings); break;
            case 'wave': drawWave(targetCtx, timeData, width, height, settings, currentMouse); break;
            case 'circle': drawCircle(targetCtx, freqData, width, height, settings); break;
            case 'particles': drawParticles(targetCtx, freqData, width, height, settings, currentMouse); break;
            case 'matrix': drawMatrix(targetCtx, freqData, width, height, settings); break;
            case 'kaleidoscope': drawKaleidoscope(targetCtx, freqData, width, height, settings); break;
            case 'tunnel': drawTunnel(targetCtx, freqData, width, height, settings); break;
            case 'text': drawTextMode(targetCtx, freqData, timeData, width, height, settings); break;
            case 'vortex': drawVortex(targetCtx, freqData, width, height, settings); break;
            case 'plasma': drawPlasma(targetCtx, freqData, width, height, settings); break;
            case 'starfield': drawStarfield(targetCtx, freqData, width, height, settings, starDataRef); break;
            case 'metaballs': drawMetaballs(targetCtx, freqData, width, height, settings); break;
            case 'lissajous': drawLissajous(targetCtx, freqData, width, height, settings, lissajousTrailRef); break;
            case 'dna': drawDNA(targetCtx, freqData, width, height, settings); break;
            case 'territory': drawTerritory(targetCtx, freqData, width, height, settings); break;
            case 'rings': drawRings(targetCtx, freqData, width, height, settings); break;
            case 'grid_warp': drawGridWarp(targetCtx, freqData, width, height, settings); break;
            case 'chrysanthemum': drawChrysanthemum(targetCtx, freqData, width, height, settings); break;
            case 'oscilloscope': drawOscilloscope(targetCtx, freqData, width, height, settings, timeData); break;
            case 'smoke': drawSmoke(targetCtx, freqData, width, height, settings); break;
          }
          targetCtx.restore();
        }

        switch (mode) {
          case 'bars': drawBars(targetCtx, freqData, width, height, settings); break;
          case 'wave': drawWave(targetCtx, timeData, width, height, settings, currentMouse); break;
          case 'circle': drawCircle(targetCtx, freqData, width, height, settings); break;
          case 'particles': drawParticles(targetCtx, freqData, width, height, settings, currentMouse); break;
          case 'matrix': drawMatrix(targetCtx, freqData, width, height, settings); break;
          case 'kaleidoscope': drawKaleidoscope(targetCtx, freqData, width, height, settings); break;
          case 'tunnel': drawTunnel(targetCtx, freqData, width, height, settings); break;
          case 'text': drawTextMode(targetCtx, freqData, timeData, width, height, settings); break;
          case 'vortex': drawVortex(targetCtx, freqData, width, height, settings); break;
          case 'plasma': drawPlasma(targetCtx, freqData, width, height, settings); break;
          case 'starfield': drawStarfield(targetCtx, freqData, width, height, settings, starDataRef); break;
          case 'metaballs': drawMetaballs(targetCtx, freqData, width, height, settings); break;
          case 'lissajous': drawLissajous(targetCtx, freqData, width, height, settings, lissajousTrailRef); break;
          case 'dna': drawDNA(targetCtx, freqData, width, height, settings); break;
          case 'rings': drawRings(targetCtx, freqData, width, height, settings); break;
          case 'grid_warp': drawGridWarp(targetCtx, freqData, width, height, settings); break;
          case 'chrysanthemum': drawChrysanthemum(targetCtx, freqData, width, height, settings); break;
          case 'oscilloscope': drawOscilloscope(targetCtx, freqData, width, height, settings, timeData); break;
          case 'smoke': drawSmoke(targetCtx, freqData, width, height, settings); break;
        }
        targetCtx.restore();
        // Always clean shadow after each mode (prevents leak to next layer/post-fx)
        targetCtx.shadowBlur = 0;
        targetCtx.shadowColor = 'transparent';
      };

      const drawAllLayers = (targetCtx: CanvasRenderingContext2D) => {
        if (settings.feedback && octx && targetCtx === ctx) {
          const target = settings.feedbackTarget;
          octx.save();
          octx.globalAlpha = 0.92;
          octx.drawImage(offscreenCanvas, -2, -2, width + 4, height + 4);
          octx.restore();

          if (target === 'primary' || target === 'both') drawMode(octx, settings.mode, false);
          if (target === 'secondary' || target === 'both') {
            if (settings.secondaryMode !== 'none') {
              octx.save();
              octx.globalCompositeOperation = settings.blendMode;
              drawMode(octx, settings.secondaryMode, true);
              octx.restore();
            }
          }

          ctx.drawImage(offscreenCanvas, 0, 0, width, height);

          if (target === 'secondary') drawMode(ctx, settings.mode, false);
          if (target === 'primary') {
            if (settings.secondaryMode !== 'none') {
              ctx.save();
              ctx.globalCompositeOperation = settings.blendMode;
              drawMode(ctx, settings.secondaryMode, true);
              ctx.restore();
            }
          }
        } else {
          drawMode(targetCtx, settings.mode, false);
          if (settings.secondaryMode !== 'none') {
            targetCtx.save();
            targetCtx.globalCompositeOperation = settings.blendMode;
            drawMode(targetCtx, settings.secondaryMode, true);
            targetCtx.restore();
          }
        }
      };

      // Apply Glitch (Reactive) — before scene draw
      if (reactiveGlitch > 0.1) {
        ctx.save();
        ctx.translate((Math.random() - 0.5) * 10 * reactiveGlitch, 0);
        if (Math.random() > 0.95) {
          ctx.fillStyle = 'rgba(255,0,0,0.2)';
          ctx.fillRect(0, Math.random() * height, width, 2);
        }
      }

      // Draw scene — shadow is OFF during layer rendering (individual modes set their own)
      drawAllLayers(ctx);

      if (reactiveGlitch > 0.1) ctx.restore();

      // Reset shadow state leaked from draw modes before any post-processing
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';

      // Lightweight chromatic aberration (single pass, no triple render)
      if (settings.chromaticAberration > 0) {
        const amount = Math.round(settings.chromaticAberration * 3 * (1 + rms));
        if (amount > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = 0.15;
          ctx.drawImage(canvas, -amount, 0);
          ctx.drawImage(canvas, amount, 0);
          ctx.restore();
        }
      }

      // 2D Vignette
      if (settings.vignette) {
        ctx.save();
        const vignetteRadius = Math.max(0.1, width / Math.max(0.1, 1.2 - pulse * 0.2));
        const gradient = ctx.createRadialGradient(
          width / 2, height / 2, width / 4,
          width / 2, height / 2, vignetteRadius
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${0.6 + pulse * 0.2})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      // 2D Noise (optimized: sparse random pixels, no individual fillRect)
      if (settings.noise > 0) {
        ctx.save();
        ctx.globalAlpha = settings.noise * (0.08 + pulse * 0.05);
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 80; i++) {
          ctx.fillRect(Math.random() * width | 0, Math.random() * height | 0, 2, 2);
        }
        ctx.restore();
      }

      // Stroboscope Intelligence
      if (settings.strobeEnabled) {
        const strobeT = time * settings.strobeSpeed * 8;
        const strobePhase = Math.sin(strobeT * Math.PI);
        // Safety limiter: cap at 15Hz (below photosensitive danger zone of 3-60Hz flickers)
        const safeStrobe = Math.abs(strobePhase) > 0.7 ? 1 : 0;
        if (safeStrobe > 0) {
          ctx.save();
          ctx.globalAlpha = 0.6;
          switch (settings.strobeType) {
            case 'bw':
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, width, height);
              break;
            case 'color':
              ctx.fillStyle = Math.sin(strobeT) > 0 ? settings.colorPrimary : settings.colorSecondary;
              ctx.fillRect(0, 0, width, height);
              break;
            case 'invert':
              ctx.globalCompositeOperation = 'difference';
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, width, height);
              break;
            case 'geometric':
              ctx.fillStyle = settings.colorPrimary;
              const geoSize = width * 0.3 * (0.5 + bassNorm);
              ctx.translate(width / 2, height / 2);
              ctx.rotate(strobeT * 0.5);
              ctx.fillRect(-geoSize / 2, -geoSize / 2, geoSize, geoSize);
              break;
          }
          ctx.restore();
        }
      }

      animationRef.current = requestAnimationFrame(render);
      } catch (err) {
        console.error("VisualizerCanvas render error:", err);
        animationRef.current = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibility);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      style={{ touchAction: 'none' }}
    />
  );
};

const drawBars = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const barCount = Math.floor(Math.min(data.length, 128) * settings.waveFrequency * (settings.geoSegments / 32));
  const barWidth = (width / barCount) * settings.barWidth * settings.geoScale;
  const spacing = (width / barCount) * (1 - settings.barWidth);
  
  ctx.fillStyle = settings.colorPrimary;

  // Single gradient reused for all bars (huge perf win)
  const barGrad = ctx.createLinearGradient(0, 0, 0, height);
  barGrad.addColorStop(0, settings.colorPrimary);
  barGrad.addColorStop(1, settings.colorSecondary);
  ctx.fillStyle = barGrad;
  ctx.shadowBlur = settings.intensity > 0.8 ? 8 : 0;
  ctx.shadowColor = settings.colorPrimary;

  for (let i = 0; i < barCount; i++) {
    const dataIndex = Math.floor((i / barCount) * data.length);
    const barHeight = (data[dataIndex] / 255) * height * settings.intensity * settings.waveAmplitude;
    const x = i * (barWidth + spacing);
    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
  }
  ctx.shadowBlur = 0;
};

const drawWave = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings,
  mouse: { x: number; y: number; active: boolean }
) => {
  ctx.lineWidth = 3;
  ctx.strokeStyle = settings.colorPrimary;
  ctx.beginPath();

  const sliceWidth = (width / data.length) * settings.waveFrequency;
  let x = 0;

  for (let i = 0; i < data.length; i++) {
    const v = ((data[i] - 128.0) * settings.waveAmplitude + 128.0) / 128.0;
    let y = (v * height) / 2;

    // Mouse distortion
    if (mouse.active) {
      const dx = mouse.x - x;
      const dy = mouse.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = Math.max(0, (150 - dist) / 150);
      y += dy * force * 0.5;
    }

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  ctx.stroke();
};

const drawCircle = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 4 * settings.geoScale;
  const barCount = Math.floor(120 * (settings.geoSegments / 32));
  const time = Date.now() * 0.001;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(time * settings.geoRotationSpeed * 0.5);

  for (let i = 0; i < barCount; i++) {
    const angle = (i * 2 * Math.PI) / barCount;
    const value = data[i % data.length] / 255;
    const barHeight = Math.max(0, value * radius * (settings.intensity || 1));

    if (!isFinite(barHeight) || !isFinite(radius)) continue;

    ctx.rotate(angle);
    
    const gradient = ctx.createLinearGradient(0, radius, 0, radius + barHeight);
    gradient.addColorStop(0, settings.colorPrimary);
    gradient.addColorStop(1, settings.colorSecondary);
    ctx.fillStyle = gradient;

    ctx.fillRect(-1, radius, 2, barHeight);
    ctx.rotate(-angle);
  }

  ctx.restore();
};

const drawKaleidoscope = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const segments = Math.max(1, settings.kaleidoscopeSegments || 8);
  const angle = (Math.PI * 2) / segments;
  const time = Date.now() * 0.001 * settings.speed;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.45;

  if (!isFinite(centerX) || !isFinite(centerY) || !isFinite(radius) || !isFinite(angle)) return;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(time * 0.1);

  for (let i = 0; i < segments; i++) {
    ctx.save();
    ctx.rotate(i * angle);

    // Draw segment
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const tanVal = Math.tan(angle / 2);
    if (isFinite(tanVal)) {
      ctx.lineTo(radius, -radius * tanVal);
      ctx.lineTo(radius, radius * tanVal);
    }
    ctx.closePath();
    ctx.clip();

    // Content of segment
    for (let j = 0; j < 30; j++) {
      const freqIndex = Math.floor((j / 30) * data.length);
      const value = data[freqIndex] / 255;
      const x = (j / 30) * radius;
      const h = value * 100 * (settings.intensity || 1);
      
      if (isFinite(x) && isFinite(h)) {
        ctx.fillStyle = `hsla(${(j * 10 + time * 50) % 360}, 100%, 50%, ${0.3 + value * 0.5})`;
        ctx.fillRect(x, -h / 2, 2, h);
      }
    }

    ctx.restore();
  }
  ctx.restore();
};

const drawTunnel = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = Date.now() * 0.001 * settings.speed;
  const centerX = width / 2;
  const centerY = height / 2;
  const rings = 20;
  
  if (!isFinite(centerX) || !isFinite(centerY)) return;

  for (let i = 0; i < rings; i++) {
    const ringIndex = (i + time * 2) % rings;
    const scale = Math.pow(1.1, ringIndex);
    const opacity = (rings - ringIndex) / rings;
    const freqIndex = Math.floor((i / rings) * data.length);
    const value = data[freqIndex] / 255;
    
    if (!isFinite(scale) || scale <= 0) continue;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.rotate(time * 0.2 + i * 0.1);
    
    ctx.strokeStyle = `hsla(${(i * 20 + time * 100) % 360}, 100%, 50%, ${opacity * 0.5})`;
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(-50, -50, 100, 100);
    
    // Pulsing inner ring
    if (value > 0.5) {
      ctx.strokeStyle = settings.colorPrimary;
      const pulseSize = value * 10;
      if (isFinite(pulseSize)) {
        ctx.strokeRect(-50 - pulseSize, -50 - pulseSize, 100 + pulseSize * 2, 100 + pulseSize * 2);
      }
    }
    
    ctx.restore();
  }
};

const drawParticles = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings,
  mouse: { x: number; y: number; active: boolean }
) => {
  const particleCount = Math.floor(60 * settings.geoComplexity);
  const time = Date.now() * 0.001 * settings.speed;
  const spread = settings.geoSpread * 0.4;

  for (let i = 0; i < particleCount; i++) {
    const freqIndex = Math.floor((i / particleCount) * data.length);
    const value = data[freqIndex] / 255;

    const turbX = settings.geoTurbulence > 0 ? Math.sin(i * 3.7 + time * 2) * settings.geoTurbulence * 30 : 0;
    const turbY = settings.geoTurbulence > 0 ? Math.cos(i * 2.3 + time * 1.5) * settings.geoTurbulence * 30 : 0;
    let x = (Math.sin(i * 0.5 + time * 0.5) * spread + 0.5) * width + turbX;
    let y = (Math.cos(i * 0.8 + time * 0.3) * spread + 0.5) * height + turbY;

    // Mouse interaction
    if (mouse.active) {
      const dx = mouse.x - x;
      const dy = mouse.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = Math.max(0, (200 - dist) / 200);
      
      x -= dx * force * 0.2;
      y -= dy * force * 0.2;
    }

    const size = Math.max(0.1, value * 60 * (settings.intensity || 1) * settings.particleSize);
    const opacity = Math.max(0, Math.min(1, (0.1 + value * 0.5) * settings.particleLife));

    if (!isFinite(x) || !isFinite(y) || !isFinite(size)) continue;

    // Simple circle, no per-particle gradient (major perf win)
    ctx.globalAlpha = opacity;
    ctx.fillStyle = settings.colorPrimary;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;
};

const drawMatrix = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const cols = 32;
  const rows = 16;
  const cellW = width / cols;
  const cellH = height / rows;

  for (let i = 0; i < cols; i++) {
    const freqValue = data[Math.floor((i / cols) * data.length)] / 255;
    const activeRows = Math.floor(freqValue * rows * settings.intensity);

    for (let j = 0; j < rows; j++) {
      const y = height - (j + 1) * cellH;
      const x = i * cellW;
      
      if (j < activeRows) {
        ctx.fillStyle = settings.colorPrimary;
        ctx.globalAlpha = (j + 1) / rows;
      } else {
        ctx.fillStyle = '#1a1a1a';
        ctx.globalAlpha = 0.1;
      }
      
      ctx.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
    }
  }
  ctx.globalAlpha = 1.0;
};

// ============================================================================
// TEXT MODE - Persistent state for advanced sub-modes
// ============================================================================
interface ShatterParticle {
  char: string;
  x: number; y: number;
  origX: number; origY: number;
  vx: number; vy: number;
  rotation: number; rotSpeed: number;
  scale: number; alpha: number;
  life: number; maxLife: number;
  fontSize: number;
  color: string;
}

interface GravityLetter {
  char: string;
  x: number; y: number;
  vx: number; vy: number;
  mass: number;
  fontSize: number;
  angle: number;
  orbitRadius: number;
  orbitSpeed: number;
  color: string;
}

let shatterParticles: ShatterParticle[] = [];
let shatterCooldown = 0;
let gravityLetters: GravityLetter[] = [];
let gravityInitialized = false;
let typestormLines: { text: string; x: number; y: number; speed: number; size: number; angle: number; wave: number; born: number }[] = [];
let typestormLastSpawn = 0;
let glitchSlices: { y: number; offset: number; height: number; decay: number }[] = [];

// Font family resolver
const getFontFamily = (font: string): string => {
  switch (font) {
    case 'mono': return '"JetBrains Mono", "Courier New", monospace';
    case 'sans': return '"Inter", "Helvetica Neue", sans-serif';
    case 'serif': return '"Georgia", "Times New Roman", serif';
    case 'display': return '"Bebas Neue", "Impact", sans-serif';
    case 'handwriting': return '"Caveat", "Comic Sans MS", cursive';
    case 'pixel': return '"Press Start 2P", "Courier New", monospace';
    default: return '"JetBrains Mono", monospace';
  }
};

// Apply text glow/stroke/blend settings
const applyTextStyle = (ctx: CanvasRenderingContext2D, settings: VisualizerSettings, bass: number) => {
  // Blend mode
  if (settings.textBlendMode && settings.textBlendMode !== 'source-over') {
    ctx.globalCompositeOperation = settings.textBlendMode;
  }
  // Glow
  const glow = settings.textGlow || 0;
  if (glow > 0) {
    ctx.shadowBlur = safeBlur(10 + glow * 30 * (1 + bass * 0.5));
    ctx.shadowColor = settings.textShadowColor || settings.colorPrimary;
  }
  // Global rotation
  if (settings.textRotation) {
    ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
    ctx.rotate((settings.textRotation * Math.PI) / 180);
    ctx.translate(-ctx.canvas.width / 2, -ctx.canvas.height / 2);
  }
};

// Draw text with stroke-only or fill mode
const drawStyledText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, settings: VisualizerSettings) => {
  if (settings.textStroke) {
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.lineWidth = 2;
    ctx.strokeText(text, x, y);
  } else {
    ctx.fillText(text, x, y);
  }
};

// Persistent state for text modes
let kineticPhase = 0;
let circuitNodes: { x: number; y: number; char: string; connections: number[] }[] = [];
let flameParticles: { x: number; y: number; char: string; life: number; vy: number; vx: number }[] = [];

const drawTextMode = (
  ctx: CanvasRenderingContext2D,
  freqData: Uint8Array,
  timeData: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = Date.now() * 0.001 * settings.textSpeed * settings.speed;
  const bass = avgRange(freqData, 0, 10);
  const mid = avgRange(freqData, 30, 100);
  const high = avgRange(freqData, 100, 200);
  const intensity = settings.intensity || 1;
  const fontFamily = getFontFamily(settings.textFont || 'mono');

  // Kick/snare transient detection (local)
  const kickRaw = avgRange(freqData, 0, 8);
  const snareRaw = avgRange(freqData, 50, 200);

  // Apply global text style (glow, blend, rotation)
  ctx.save();
  applyTextStyle(ctx, settings, bass);

  // ── Artist subtitle (rendered under all text modes) ───────────────
  if (settings.textArtist) {
    ctx.save();
    const artistSize = Math.max(10, settings.textFontSize * 1.5);
    ctx.font = `${artistSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.35 + bass * 0.2;
    ctx.fillStyle = settings.colorPrimary;
    if (settings.textGlow > 0) {
      ctx.shadowBlur = safeBlur(6 + settings.textGlow * 10);
      ctx.shadowColor = settings.textShadowColor || settings.colorPrimary;
    }
    ctx.fillText(settings.textArtist, width / 2, height / 2 + artistSize * 2.2);
    ctx.restore();
  }

  // ==========================================
  // MODE: SHATTER (Bass-Drop Text Explosion)
  // ==========================================
  if (settings.textDisplayMode === 'shatter') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(40, settings.textFontSize * 5);

    // Spawn new shatter event on bass transient
    shatterCooldown = Math.max(0, shatterCooldown - 1);
    if (bass > 0.65 && shatterCooldown <= 0) {
      shatterCooldown = 15;
      const fontSize = baseFontSize + bass * 60;
      ctx.font = `900 ${fontSize}px "Inter", sans-serif`;
      const measured = ctx.measureText(text);
      const textW = measured.width;
      const startX = (width - textW) / 2;
      const startY = height / 2;

      // Create particles for each character (hard limit 200)
      if (shatterParticles.length > 200) shatterParticles.length = 200;
      for (let i = 0; i < text.length && shatterParticles.length < 200; i++) {
        const charW = ctx.measureText(text[i]).width;
        const cx = startX + ctx.measureText(text.substring(0, i)).width + charW / 2;
        const angle = Math.random() * Math.PI * 2;
        const force = (3 + Math.random() * 8) * bass * intensity;
        shatterParticles.push({
          char: text[i],
          x: cx, y: startY,
          origX: cx, origY: startY,
          vx: Math.cos(angle) * force * (1 + Math.random()),
          vy: Math.sin(angle) * force * (1 + Math.random()) - 2,
          rotation: 0,
          rotSpeed: (Math.random() - 0.5) * 0.3,
          scale: 1 + Math.random() * 0.5,
          alpha: 1,
          life: 0,
          maxLife: 60 + Math.random() * 90,
          fontSize: fontSize,
          color: Math.random() > 0.5 ? settings.colorPrimary : settings.colorSecondary,
        });
      }
    }

    // Limit particle count
    if (shatterParticles.length > 500) {
      shatterParticles.length = 500;
    }

    ctx.save();

    // Draw the "intact" text when not shattering (breathing with bass)
    if (shatterCooldown > 5) {
      // Text is reforming or just shattered - skip intact display
    } else {
      const breathScale = 1 + bass * 0.15;
      const fontSize = baseFontSize * breathScale;
      ctx.font = `900 ${fontSize}px "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Chromatic split on mids
      const chromaShift = mid * 6 * intensity;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = settings.colorPrimary;
      ctx.fillText(text, width / 2 - chromaShift, height / 2);
      ctx.fillStyle = settings.colorSecondary;
      ctx.fillText(text, width / 2 + chromaShift, height / 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = safeBlur(10 + bass * 12);
      ctx.shadowColor = settings.colorPrimary;
      ctx.fillText(text, width / 2, height / 2);
      ctx.shadowBlur = 0;
    }

    // Single font size for all particles (avoid per-particle ctx.font = Chrome font cache killer)
    const pFontSize = Math.round(baseFontSize);
    ctx.font = `900 ${pFontSize}px "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Update and draw shatter particles — in-place compaction (no splice)
    let shatterWrite = 0;
    for (let i = 0; i < shatterParticles.length; i++) {
      const p = shatterParticles[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // gravity
      p.vx *= 0.98; // air resistance
      p.rotation += p.rotSpeed;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);

      // Audio-reactive: bass pushes particles outward
      if (bass > 0.4) {
        const dx = p.x - width / 2;
        const dy = p.y - height / 2;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1;
        p.vx += (dx / dist) * bass * 0.5;
        p.vy += (dy / dist) * bass * 0.5;
      }

      if (p.life >= p.maxLife) continue; // skip dead — compaction removes them
      shatterParticles[shatterWrite++] = p;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.scale(p.scale, p.scale);
      ctx.globalAlpha = p.alpha;

      // Glow trail
      ctx.shadowBlur = safeBlur(8 + bass * 7);
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.fillText(p.char, 0, 0);

      // White core
      ctx.shadowBlur = 0;
      ctx.globalAlpha = p.alpha * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillText(p.char, 0, 0);

      ctx.restore();
    }
    shatterParticles.length = shatterWrite;

    // Afterimage streaks from particles (motion blur effect)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.05;
    for (const p of shatterParticles) {
      if (p.alpha < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 4, p.y - p.vy * 4);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.fontSize * 0.15;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // MODE: LIQUID (Fluid Morphing Typography)
  // ==========================================
  if (settings.textDisplayMode === 'liquid') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(60, settings.textFontSize * 6);
    const cx = width / 2;
    const cy = height / 2;

    ctx.save();

    // Draw text to measure and then manipulate
    const fontSize = baseFontSize + bass * 40;
    ctx.font = `900 ${fontSize}px "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Multiple distorted layers create liquid feel
    const layers = 7;
    for (let layer = 0; layer < layers; layer++) {
      const t = layer / layers;
      const phaseOffset = t * Math.PI * 2;

      ctx.save();
      ctx.translate(cx, cy);

      // Liquid distortion: wave-based transform per layer
      const waveX = Math.sin(time * 1.5 + phaseOffset) * (20 + bass * 60) * intensity;
      const waveY = Math.cos(time * 1.1 + phaseOffset) * (15 + mid * 40) * intensity;

      // Scale breathing per layer
      const breathScale = 1 + Math.sin(time * 2 + phaseOffset) * 0.08 * bass;
      // Skew for liquid stretching
      const skewX = Math.sin(time * 0.7 + phaseOffset) * bass * 0.15 * intensity;
      const skewY = Math.cos(time * 0.9 + phaseOffset) * mid * 0.1 * intensity;

      ctx.transform(breathScale, skewY, skewX, breathScale, waveX, waveY);

      // Color interpolation across layers
      const hue1 = (time * 30 + t * 360) % 360;
      const saturation = 70 + bass * 30;
      const lightness = 40 + t * 30;

      ctx.globalAlpha = layer === layers - 1 ? 1 : (0.12 + high * 0.08);
      ctx.fillStyle = layer === layers - 1 ? '#fff' : `hsl(${hue1}, ${saturation}%, ${lightness}%)`;

      // Shadow/glow for top layer
      if (layer === layers - 1) {
        ctx.shadowBlur = safeBlur(10 + bass * 10);
        ctx.shadowColor = settings.colorPrimary;
      }

      // Draw individual characters with per-char wave offset
      const fullText = text;
      const totalWidth = ctx.measureText(fullText).width;
      let xOff = -totalWidth / 2;

      for (let i = 0; i < fullText.length; i++) {
        const charW = ctx.measureText(fullText[i]).width;
        const charPhase = (i / fullText.length) * Math.PI * 2;

        // Per-character liquid offset
        const charWaveY = Math.sin(time * 3 + charPhase + phaseOffset) * (5 + bass * 25) * intensity;
        const charWaveX = Math.cos(time * 2.3 + charPhase * 1.5) * (3 + mid * 10) * intensity;

        // Per-character scale pulse on beat
        const charScale = 1 + Math.sin(time * 4 + charPhase) * bass * 0.2;

        ctx.save();
        ctx.translate(xOff + charW / 2 + charWaveX, charWaveY);
        ctx.scale(charScale, charScale);
        ctx.fillText(fullText[i], 0, 0);
        ctx.restore();

        xOff += charW;
      }

      ctx.restore();
    }

    // Drip effect: liquid drops falling from text on bass hits
    if (bass > 0.5) {
      ctx.globalAlpha = bass * 0.4;
      for (let i = 0; i < 8; i++) {
        const dx = (Math.random() - 0.5) * fontSize * text.length * 0.3;
        const dropY = cy + fontSize * 0.5 + Math.random() * bass * 100;
        const dropSize = 2 + Math.random() * 4 * bass;
        ctx.beginPath();
        ctx.ellipse(cx + dx, dropY, dropSize, dropSize * 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = settings.colorPrimary;
        ctx.fill();
      }
    }

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // MODE: GLITCH MATRIX (Databending Typography)
  // ==========================================
  if (settings.textDisplayMode === 'glitch_matrix') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(30, settings.textFontSize * 4);
    const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR|Brave|CriOS/.test(navigator.userAgent);
    // Chrome can stall on dense unicode glyph rasterization in this mode.
    const glitchChars = isChrome ? '01<>[]{}+-*#@' : '\u00a7\u00b6\u00d8\u00c6\u2206\u2202\u03a9\u03a3\u03c0\u0416\u0429\u042f\u042d\u0426\u4e16\u754c\u3042\u30ab\u25a0\u25a1\u25b2\u25b3\u25cf\u25cb';

    ctx.save();

    // Horizontal glitch slices triggered by snare
    if (snareRaw > 0.35) {
      const numSlices = 3 + Math.floor(snareRaw * 8);
      glitchSlices = [];
      for (let i = 0; i < numSlices; i++) {
        glitchSlices.push({
          y: Math.random() * height,
          offset: (Math.random() - 0.5) * 80 * snareRaw * intensity,
          height: 5 + Math.random() * 40,
          decay: 1,
        });
      }
    }

    // Draw main text with glitch displacement
    const fontSize = baseFontSize + bass * 30;
    ctx.font = `900 ${fontSize}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Scanline background matrix rain
    const matrixSize = isChrome ? Math.max(12, 14 + high * 4) : Math.max(8, 10 + high * 6);
    ctx.font = `${matrixSize}px "JetBrains Mono", monospace`;
    ctx.globalAlpha = 0.15 + high * 0.2;
    const matrixCols = Math.floor(width / (matrixSize * 0.7));
    const matrixRows = Math.floor(height / (matrixSize * 1.2));
    const maxCells = isChrome ? 700 : 2200;
    const stride = Math.max(1, Math.ceil((matrixCols * matrixRows) / maxCells));
    for (let col = 0; col < matrixCols; col++) {
      for (let row = 0; row < matrixRows; row += stride) {
        const fall = ((time * 3 + col * 0.5) % matrixRows);
        const dist = Math.abs(row - fall);
        if (dist > 5) continue;
        const a = Math.max(0, 1 - dist / 5) * (0.3 + high * 0.5);
        ctx.globalAlpha = a;
        const gChar = glitchChars[Math.floor(Math.random() * glitchChars.length)];
        ctx.fillStyle = settings.colorPrimary;
        ctx.fillText(gChar, col * matrixSize * 0.7, row * matrixSize * 1.2);
      }
    }

    // Main text with glitch offset
    ctx.font = `900 ${fontSize}px "JetBrains Mono", monospace`;
    ctx.globalAlpha = 1;

    // RGB channel split
    const rgbSplit = (bass > 0.4 ? bass * 12 : 2) * intensity;
    const glitchOffset = (snareRaw > 0.3) ? (Math.random() - 0.5) * 20 * snareRaw : 0;

    // Red channel
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ff0040';
    ctx.fillText(text, width / 2 - rgbSplit + glitchOffset, height / 2);
    // Green channel
    ctx.fillStyle = '#00ff80';
    ctx.fillText(text, width / 2 + glitchOffset, height / 2 - rgbSplit * 0.5);
    // Blue channel
    ctx.fillStyle = '#0080ff';
    ctx.fillText(text, width / 2 + rgbSplit + glitchOffset, height / 2 + rgbSplit * 0.3);
    // White core
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.fillText(text, width / 2 + glitchOffset, height / 2);

    // Character corruption: randomly replace chars on beat
    if (bass > 0.5 || snareRaw > 0.4) {
      ctx.font = `900 ${fontSize}px "JetBrains Mono", monospace`;
      const fullW = ctx.measureText(text).width;
      const avgCharW = text.length > 0 ? fullW / text.length : 0;
      let xPos = (width - fullW) / 2;
      for (let i = 0; i < text.length; i++) {
        const cw = avgCharW || ctx.measureText(text[i]).width;
        if (Math.random() < bass * 0.4) {
          const gChar = glitchChars[Math.floor(Math.random() * glitchChars.length)];
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = Math.random() > 0.5 ? settings.colorPrimary : settings.colorSecondary;
          ctx.fillText(gChar, xPos + cw / 2, height / 2 + (Math.random() - 0.5) * 10);
        }
        xPos += cw;
      }
    }

    // Apply glitch slices (horizontal displacement bands)
    for (const slice of glitchSlices) {
      if (slice.decay <= 0.05) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, slice.y, width, slice.height);
      ctx.clip();
      ctx.clearRect(0, slice.y, width, slice.height);
      ctx.translate(slice.offset * slice.decay, 0);
      ctx.globalAlpha = slice.decay;
      ctx.fillStyle = Math.random() > 0.5 ? settings.colorPrimary : '#fff';
      ctx.font = `900 ${fontSize}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, width / 2, height / 2);
      ctx.restore();
      slice.decay *= 0.9;
    }

    // Noise overlay on highs
    if (high > 0.3) {
      ctx.globalAlpha = high * 0.1;
      const noiseSize = 3;
      const noiseCount = isChrome ? 24 : 80;
      for (let i = 0; i < noiseCount; i++) {
        const nx = Math.random() * width;
        const ny = Math.random() * height;
        ctx.fillStyle = `rgb(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255})`;
        ctx.fillRect(nx, ny, noiseSize, noiseSize * (1 + Math.random() * 3));
      }
    }

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // MODE: GRAVITY WELL (Orbital Typography)
  // ==========================================
  if (settings.textDisplayMode === 'gravity_well') {
    const text = settings.customText ?? 'ELASTIC PRISM PRO';
    const cx = width / 2;
    const cy = height / 2;

    // Initialize orbiting letters
    if (!gravityInitialized || gravityLetters.length !== text.length) {
      gravityLetters = [];
      for (let i = 0; i < text.length; i++) {
        const angle = (i / text.length) * Math.PI * 2;
        const radius = 120 + Math.random() * 100;
        gravityLetters.push({
          char: text[i],
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          vx: Math.sin(angle) * 2,
          vy: -Math.cos(angle) * 2,
          mass: 1 + Math.random() * 2,
          fontSize: Math.max(24, settings.textFontSize * 3 + Math.random() * 20),
          angle: angle,
          orbitRadius: radius,
          orbitSpeed: 0.3 + Math.random() * 0.5,
          color: i % 2 === 0 ? settings.colorPrimary : settings.colorSecondary,
        });
      }
      gravityInitialized = true;
    }

    ctx.save();

    // Central gravity well visualization
    const wellPulse = 1 + bass * 0.8;
    const wellRadius = 30 * wellPulse;

    // Gravitational lensing rings
    for (let ring = 0; ring < 5; ring++) {
      const r = wellRadius + ring * (15 + bass * 20);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = settings.colorPrimary;
      ctx.globalAlpha = 0.1 * (1 - ring / 5) + bass * 0.1;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Event horizon glow
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, wellRadius * 3);
    gradient.addColorStop(0, settings.colorPrimary);
    gradient.addColorStop(0.5, settings.colorSecondary + '40');
    gradient.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.3 + bass * 0.4;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, wellRadius * 3, 0, Math.PI * 2);
    ctx.fill();

    // Set font once for all letters (avoid per-letter ctx.font = Chrome perf killer)
    const gravFontSize = Math.round(Math.max(24, settings.textFontSize * 3));
    ctx.font = `900 ${gravFontSize}px "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Update and draw orbiting letters
    const gravityStrength = 0.5 + bass * 3;
    const expansionForce = mid * 2 * intensity;

    for (let i = 0; i < gravityLetters.length; i++) {
      const letter = gravityLetters[i];

      // Update orbit based on audio
      letter.angle += letter.orbitSpeed * 0.02 * (1 + bass);
      letter.orbitRadius = 100 + 80 * Math.sin(time * 0.5 + i) + expansionForce * 60;

      // Bass contracts orbit, mids expand
      const targetR = letter.orbitRadius * (1 - bass * 0.4 + mid * 0.3);
      const targetX = cx + Math.cos(letter.angle + time * 0.3) * targetR;
      const targetY = cy + Math.sin(letter.angle + time * 0.3) * targetR;

      // Smooth follow with spring physics
      const dx = targetX - letter.x;
      const dy = targetY - letter.y;
      letter.vx += dx * 0.05;
      letter.vy += dy * 0.05;
      letter.vx *= 0.92;
      letter.vy *= 0.92;
      letter.x += letter.vx;
      letter.y += letter.vy;

      // On kick: letters rush toward center then bounce back
      if (bass > 0.6) {
        const toCenterX = cx - letter.x;
        const toCenterY = cy - letter.y;
        const dist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY) + 1;
        letter.vx += (toCenterX / dist) * gravityStrength;
        letter.vy += (toCenterY / dist) * gravityStrength;
      }

      // Snare: scatter outward
      if (snareRaw > 0.4) {
        const fromCenterX = letter.x - cx;
        const fromCenterY = letter.y - cy;
        const dist = Math.sqrt(fromCenterX * fromCenterX + fromCenterY * fromCenterY) + 1;
        letter.vx += (fromCenterX / dist) * snareRaw * 5;
        letter.vy += (fromCenterY / dist) * snareRaw * 5;
      }

      // Draw connection lines to neighbors
      const next = gravityLetters[(i + 1) % gravityLetters.length];
      ctx.beginPath();
      ctx.moveTo(letter.x, letter.y);
      ctx.lineTo(next.x, next.y);
      ctx.strokeStyle = settings.colorPrimary;
      ctx.globalAlpha = 0.15 + bass * 0.15;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw the letter (use scale instead of per-letter ctx.font change)
      const dynamicScale = 1 + bass * 0.3;
      ctx.globalAlpha = 0.8 + bass * 0.2;

      ctx.save();
      ctx.translate(letter.x, letter.y);
      ctx.scale(dynamicScale, dynamicScale);

      // Glow
      ctx.shadowBlur = safeBlur(8 + bass * 7);
      ctx.shadowColor = letter.color;
      ctx.fillStyle = letter.color;
      ctx.fillText(letter.char, 0, 0);

      // White highlight
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.3 + high * 0.3;
      ctx.fillStyle = '#fff';
      ctx.fillText(letter.char, 0, 0);
      ctx.restore();
    }

    // On massive bass hit: all letters form the word in center then explode
    if (bass > 0.8) {
      ctx.globalAlpha = bass * 0.4;
      ctx.font = `900 ${settings.textFontSize * 8}px "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = MAX_SHADOW;
      ctx.shadowColor = '#fff';
      ctx.fillStyle = '#fff';
      ctx.fillText(text, cx, cy);
    }

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // MODE: TYPESTORM (Kinetic Type Tornado)
  // ==========================================
  if (settings.textDisplayMode === 'typestorm') {
    const text = settings.customText ?? 'ELASTIC PRISM PRO';
    const words = text.split(/\s+/);
    const now = Date.now();

    // Spawn new text lines on beat
    const spawnRate = bass > 0.4 ? 60 : 200;
    if (now - typestormLastSpawn > spawnRate) {
      typestormLastSpawn = now;
      const word = words[Math.floor(Math.random() * words.length)];
      const side = Math.floor(Math.random() * 4); // 0=left, 1=right, 2=top, 3=bottom
      let x = 0, y = 0, angle = 0;

      switch (side) {
        case 0: x = -100; y = Math.random() * height; angle = Math.random() * 0.3 - 0.15; break;
        case 1: x = width + 100; y = Math.random() * height; angle = Math.PI + Math.random() * 0.3 - 0.15; break;
        case 2: x = Math.random() * width; y = -100; angle = Math.PI / 2 + Math.random() * 0.3 - 0.15; break;
        case 3: x = Math.random() * width; y = height + 100; angle = -Math.PI / 2 + Math.random() * 0.3 - 0.15; break;
      }

      if (typestormLines.length > 40) typestormLines.length = 40; // Hard limit
      typestormLines.push({
        text: bass > 0.6 ? text : word,
        x, y,
        speed: 2 + Math.random() * 4 + bass * 6,
        size: bass > 0.6 ? 40 + bass * 80 : 16 + Math.random() * 30 + mid * 20,
        angle,
        wave: Math.random() * Math.PI * 2,
        born: now,
      });
    }

    // Limit
    if (typestormLines.length > 80) {
      typestormLines.length = 80;
    }

    ctx.save();

    // Vortex center pull effect
    const cx = width / 2 + Math.sin(time * 0.4) * 50;
    const cy = height / 2 + Math.cos(time * 0.3) * 30;

    // Background vortex spiral
    ctx.globalAlpha = 0.05 + bass * 0.05;
    for (let spiral = 0; spiral < 3; spiral++) {
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 8; a += 0.1) {
        const r = a * 15 + spiral * 30 + time * 50;
        const sx = cx + Math.cos(a + time * 0.5 + spiral) * r;
        const sy = cy + Math.sin(a + time * 0.5 + spiral) * r;
        if (a === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = settings.colorPrimary;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Set font once — use scale() for per-line size variation (avoids Chrome font cache thrash)
    const tsBaseFontSize = 24;
    ctx.font = `900 ${tsBaseFontSize}px "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Update and draw typestorm lines — in-place compaction (no splice)
    let tsWrite = 0;
    for (let i = 0; i < typestormLines.length; i++) {
      const line = typestormLines[i];
      const age = (now - line.born) * 0.001;

      // Move toward vortex center with spiral
      const dx = cx - line.x;
      const dy = cy - line.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 1;
      const pullStrength = 0.3 + bass * 0.8;

      // Spiral motion
      const perpX = -dy / dist;
      const perpY = dx / dist;
      line.x += (dx / dist) * pullStrength + perpX * 2 + Math.cos(line.angle) * line.speed;
      line.y += (dy / dist) * pullStrength + perpY * 2 + Math.sin(line.angle) * line.speed;

      // Wave distortion
      line.wave += 0.05;
      const waveOff = Math.sin(line.wave) * mid * 20;

      // Fade when near center or too old
      const alpha = Math.min(1, age * 2) * Math.min(1, dist / 100);
      if (dist < 20 || age > 8) continue; // skip dead — compaction removes them
      typestormLines[tsWrite++] = line;

      // Scale to achieve target size instead of changing font
      const scaleBoost = Math.max(1, 3 - dist / 200);
      const targetScale = (line.size * scaleBoost) / tsBaseFontSize;

      ctx.save();
      ctx.translate(line.x + waveOff, line.y);

      // Rotation follows velocity toward center
      const rotAngle = Math.atan2(dy, dx) + Math.PI / 2;
      ctx.rotate(rotAngle);
      ctx.scale(targetScale, targetScale);

      ctx.globalAlpha = alpha * (0.6 + bass * 0.4);

      // Glow
      ctx.shadowBlur = safeBlur(5 + bass * 10);
      ctx.shadowColor = settings.colorPrimary;

      // Color based on distance
      const hue = (dist / 3 + time * 50) % 360;
      ctx.fillStyle = dist < 150 ? '#fff' : `hsl(${hue}, 80%, 60%)`;
      ctx.fillText(line.text, 0, 0);

      ctx.restore();
    }
    typestormLines.length = tsWrite;

    // Central word flash on peak bass
    if (bass > 0.7) {
      ctx.globalAlpha = (bass - 0.7) * 3;
      ctx.font = `900 ${60 + bass * 100}px "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = MAX_SHADOW;
      ctx.shadowColor = '#fff';
      ctx.fillStyle = '#fff';
      ctx.fillText(text, cx, cy);
    }

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // MODE: ECHO CHAMBER (Echo/Delay Typography)
  // ==========================================
  if (settings.textDisplayMode === 'echo_chamber') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(30, settings.textFontSize * 4);
    const cx = width / 2;
    const cy = height / 2;
    const echoCount = Math.min(8, Math.floor(2 + bass * 6 * intensity));
    const sp = settings.speed || 1;

    ctx.save();
    ctx.font = `900 ${baseFontSize}px "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Parse primary and secondary colors once for interpolation
    const pR = parseInt(settings.colorPrimary.slice(1, 3), 16);
    const pG = parseInt(settings.colorPrimary.slice(3, 5), 16);
    const pB = parseInt(settings.colorPrimary.slice(5, 7), 16);
    const sR = parseInt(settings.colorSecondary.slice(1, 3), 16);
    const sG = parseInt(settings.colorSecondary.slice(3, 5), 16);
    const sB = parseInt(settings.colorSecondary.slice(5, 7), 16);

    // Draw echoes from back to front (farthest echo first)
    for (let i = echoCount - 1; i >= 0; i--) {
      const t = i / Math.max(1, echoCount - 1); // 0 = front, 1 = farthest echo
      const delay = t * 0.4 * sp;
      const echoTime = time - delay * 3;

      const offsetX = Math.sin(echoTime * 1.2) * (30 + t * 80) * intensity;
      const offsetY = Math.cos(echoTime * 0.8) * (20 + t * 50) * intensity;
      const rotation = Math.sin(echoTime * 0.5) * t * 0.15 * intensity;
      const scale = 1 + t * 0.3 * bass;

      ctx.globalAlpha = (1 - t * 0.85) * Math.max(0.1, 0.3 + bass * 0.7);

      // Interpolate color
      const r = Math.round(pR + (sR - pR) * t);
      const g = Math.round(pG + (sG - pG) * t);
      const b2 = Math.round(pB + (sB - pB) * t);
      ctx.fillStyle = `rgb(${r},${g},${b2})`;

      const x = cx + offsetX;
      const y = cy + offsetY;

      if (Math.abs(rotation) > 0.01 || Math.abs(scale - 1) > 0.01) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.scale(scale, scale);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(text, x, y);
      }
    }

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // MODE: WAVEFORM TEXT (Text shaped by waveform)
  // ==========================================
  if (settings.textDisplayMode === 'waveform_text') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const fontSize = Math.max(14, settings.textFontSize * 2);
    const amplitude = (100 + bass * 200) * (settings.intensity || 1);
    const cy = height / 2;

    ctx.save();
    ctx.font = `700 ${fontSize}px "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Parse colors once
    const pR = parseInt(settings.colorPrimary.slice(1, 3), 16);
    const pG = parseInt(settings.colorPrimary.slice(3, 5), 16);
    const pB = parseInt(settings.colorPrimary.slice(5, 7), 16);
    const sR = parseInt(settings.colorSecondary.slice(1, 3), 16);
    const sG = parseInt(settings.colorSecondary.slice(3, 5), 16);
    const sB = parseInt(settings.colorSecondary.slice(5, 7), 16);

    // Calculate how many chars fit across width
    const charWidth = fontSize * 0.65;
    const totalChars = Math.min(180, Math.floor(width / charWidth));
    const textLen = text.length;
    const startX = (width - totalChars * charWidth) / 2;
    const scrollOffset = Math.floor(time * 2 * (settings.speed || 1));

    ctx.globalAlpha = 0.9;

    for (let i = 0; i < totalChars; i++) {
      const charIndex = (i + scrollOffset) % textLen;
      const ch = text[charIndex < 0 ? charIndex + textLen : charIndex];

      // Map char position to timeData index
      const tdIdx = Math.floor((i / totalChars) * timeData.length);
      const waveVal = (timeData[tdIdx] - 128) / 128; // -1 to 1
      const yOff = waveVal * amplitude;

      // Color interpolation along the waveform
      const t = i / Math.max(1, totalChars - 1);
      const r = Math.round(pR + (sR - pR) * t);
      const g = Math.round(pG + (sG - pG) * t);
      const b2 = Math.round(pB + (sB - pB) * t);
      ctx.fillStyle = `rgb(${r},${g},${b2})`;

      const x = startX + i * charWidth;
      ctx.fillText(ch, x, cy + yOff);
    }

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // MODE: NEON SIGN (Flickering neon tube typography)
  // ==========================================
  if (settings.textDisplayMode === 'neon_sign') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(40, settings.textFontSize * 5);
    const cx = width / 2;
    const cy = height / 2;
    const neonColor = settings.colorPrimary;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${baseFontSize}px "Inter", sans-serif`;

    // Calculate glow intensity: pulses on kick, dims in silence
    const glowBase = 0.3 + bass * 0.7 * (settings.intensity || 1);
    const kickPulse = kickRaw > 0.6 ? (kickRaw - 0.6) * 5 : 0; // 0-2 range on kick
    const glowStrength = Math.min(1, glowBase + kickPulse * 0.5);

    // Layer 1: Glow pass — capped shadowBlur for Chrome perf (Chrome does SW blur)
    const cappedBlur = Math.min(15, 8 + glowStrength * 7);
    ctx.shadowBlur = cappedBlur;
    ctx.shadowColor = neonColor;
    ctx.globalAlpha = glowStrength * 0.6;
    ctx.fillStyle = neonColor;

    // Draw full text with glow
    ctx.fillText(text, cx, cy);

    // Layer 2: Sharp foreground pass (reset shadow)
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = glowStrength;
    ctx.fillStyle = '#fff';
    ctx.fillText(text, cx, cy);

    // Layer 3: Flicker — lightweight: skip measureText per-char, use cached total width
    const totalW = ctx.measureText(text).width;
    const flickerTime = Math.floor(time * 8);

    ctx.fillStyle = `rgba(0,0,0,1)`;

    // Approximate char widths from total (monospace assumption for perf)
    const avgCharW = totalW / Math.max(1, text.length);
    let xPos = cx - totalW / 2;

    // Max 2 chars flicker at once
    let flickerCount = 0;
    for (let i = 0; i < text.length && flickerCount < 2; i++) {
      const hash = (i * 7 + flickerTime * 3) % 17;
      if (hash < 3 && text[i] !== ' ') {
        const flickAlpha = 0.5 + Math.sin(time * 20 + i * 5) * 0.3;
        ctx.globalAlpha = flickAlpha * glowStrength;
        ctx.fillText(text[i], xPos + avgCharW / 2, cy);
        flickerCount++;
      }
      xPos += avgCharW;
    }

    // Subtle underglow line
    ctx.globalAlpha = glowStrength * 0.15;
    ctx.fillStyle = neonColor;
    ctx.fillRect(cx - totalW / 2 - 10, cy + baseFontSize * 0.45, totalW + 20, 2);

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // ORIGINAL MODE: READABLE
  // ==========================================
  if (settings.textDisplayMode === 'readable') {
    const text = settings.customText ?? 'ELASTIC PRISM PRO';
    const readBaseFontSize = Math.max(20, settings.textFontSize * 4);
    const readBassScale = 1 + (bass * 50) / readBaseFontSize;

    ctx.save();
    ctx.font = `900 ${readBaseFontSize}px "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const offsetX = Math.sin(time * 0.5) * 50;
    const offsetY = Math.cos(time * 0.3) * 30;

    ctx.shadowBlur = safeBlur(10 * (1 + bass));
    ctx.shadowColor = settings.colorPrimary;

    for (let i = 0; i < 3; i++) {
      const shift = (i - 1) * 5 * bass;
      ctx.fillStyle = i === 0 ? settings.colorPrimary : (i === 1 ? settings.colorSecondary : '#fff');
      ctx.globalAlpha = i === 2 ? 1 : 0.5;
      ctx.save();
      ctx.translate(width / 2 + offsetX + shift, height / 2 + offsetY);
      ctx.scale(readBassScale, readBassScale);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    ctx.globalAlpha = 0.1;
    ctx.font = `100 ${readBaseFontSize * 0.5}px "Inter", sans-serif`;
    for (let i = 0; i < 5; i++) {
      const x = (width / 6) * (i + 1);
      const y = (height / 6) * (i + 1);
      ctx.fillText(text, x, y + Math.sin(time + i) * 100);
    }

    ctx.restore();
    ctx.restore(); return;
  }

  // ==========================================
  // MODE: KINETIC TYPE (Letters fly in from edges, assemble into word on beat)
  // ==========================================
  if (settings.textDisplayMode === 'kinetic_type') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(50, settings.textFontSize * 4);
    const letters = text.split('');
    kineticPhase += 0.016 * settings.textSpeed;
    const assembled = bass > 0.5;

    ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const totalWidth = ctx.measureText(text).width;
    const startX = (width - totalWidth) / 2;

    for (let i = 0; i < letters.length; i++) {
      const letterWidth = ctx.measureText(letters[i]).width;
      const targetX = startX + ctx.measureText(text.substring(0, i)).width + letterWidth / 2;
      const targetY = height / 2;

      // Each letter has a unique orbit
      const angle = kineticPhase * (1 + i * 0.3) + i * 1.2;
      const radius = assembled ? 5 * (1 - bass) : 150 + Math.sin(angle * 0.5) * 100;
      const x = targetX + Math.cos(angle) * radius;
      const y = targetY + Math.sin(angle * 0.7) * radius * 0.6;
      const letterScale = assembled ? 1.0 + bass * 0.3 : 0.6 + Math.sin(angle) * 0.3;
      const rot = assembled ? 0 : Math.sin(angle) * 0.4;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(letterScale, letterScale);
      ctx.globalAlpha = 0.7 + (assembled ? 0.3 : Math.sin(angle + i) * 0.3);

      // Color per letter based on frequency
      const freqIdx = Math.floor((i / letters.length) * freqData.length * 0.5);
      const freqVal = freqData[freqIdx] / 255;
      const hue = (i / letters.length) * 360 + time * 20;
      ctx.fillStyle = freqVal > 0.6 ? `hsl(${hue}, 100%, 80%)` : settings.colorPrimary;
      drawStyledText(ctx, letters[i], 0, 0, settings);
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  // ==========================================
  // MODE: MIRROR TEXT (Symmetrical text kaleidoscope)
  // ==========================================
  if (settings.textDisplayMode === 'mirror_text') {
    const text = settings.customText ?? 'PRISM';
    const baseFontSize = Math.max(30, settings.textFontSize * 3);
    const segments = Math.max(2, Math.floor(settings.geoSymmetry || 4));

    ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const mirrorBassScale = 1 + (bass * 30) / baseFontSize;

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(mirrorBassScale, mirrorBassScale);

    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2 + time * 0.3;
      ctx.save();
      ctx.rotate(angle);

      // Mirror every other segment
      if (s % 2 === 1) ctx.scale(-1, 1);

      const radius = 80 + bass * 100 + mid * 50;
      const letters = text.split('');
      for (let i = 0; i < letters.length; i++) {
        const lx = radius + i * (baseFontSize * 0.7 + settings.textLetterSpacing);
        const ly = Math.sin(time * 2 + i * 0.5 + s) * 20 * high;
        const freqIdx = Math.floor(((s * letters.length + i) / (segments * letters.length)) * freqData.length * 0.5);
        const val = freqData[freqIdx] / 255;
        const hue = (s / segments) * 360 + i * 30 + time * 50;
        ctx.fillStyle = val > 0.5 ? `hsl(${hue}, 90%, 70%)` : settings.colorPrimary;
        ctx.globalAlpha = 0.5 + val * 0.5;
        drawStyledText(ctx, letters[i], lx, ly, settings);
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
    return;
  }

  // ==========================================
  // MODE: SPECTRUM LETTERS (Each letter = one frequency band, height = amplitude)
  // ==========================================
  if (settings.textDisplayMode === 'spectrum_letters') {
    const text = settings.customText ?? 'ELASTIC PRISM PRO';
    const letters = text.split('');
    const baseFontSize = Math.max(24, settings.textFontSize * 2.5);
    const spacing = Math.max(baseFontSize * 0.8, width / (letters.length + 1));

    ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';

    for (let i = 0; i < letters.length; i++) {
      const freqIdx = Math.floor((i / letters.length) * freqData.length * 0.5);
      const val = freqData[freqIdx] / 255;
      const x = spacing * (i + 0.5);
      const baseY = height * 0.7;
      const jumpHeight = val * height * 0.5 * intensity;
      const y = baseY - jumpHeight;
      const scale = 0.5 + val * 1.5;
      const hue = (i / letters.length) * 360 + time * 30;

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, scale);
      ctx.rotate(Math.sin(time + i * 0.5) * val * 0.3);
      ctx.fillStyle = `hsl(${hue}, 85%, ${40 + val * 50}%)`;
      ctx.globalAlpha = 0.4 + val * 0.6;
      drawStyledText(ctx, letters[i], 0, 0, settings);

      // Reflection
      ctx.globalAlpha = 0.1 + val * 0.15;
      ctx.scale(1, -0.5);
      ctx.translate(0, -baseFontSize * 1.5);
      drawStyledText(ctx, letters[i], 0, 0, settings);
      ctx.restore();
    }

    // Bass bar at bottom
    ctx.fillStyle = settings.colorPrimary;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(0, height * 0.75, width * bass, 3);
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  // ==========================================
  // MODE: PARTICLE TEXT (Text dissolves into particles, reforms on beat)
  // ==========================================
  if (settings.textDisplayMode === 'particle_text') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(60, settings.textFontSize * 5);

    // Measure text positions — single font, use approximate char widths
    ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cx = width / 2;
    const cy = height / 2;
    const dissolve = 1 - bass; // More bass = more assembled
    const letters = text.split('');
    const totalW = ctx.measureText(text).width;
    // Approximate char width to avoid per-char measureText calls
    const ptAvgCharW = totalW / Math.max(1, letters.length);

    // Reduce particle count for Chrome perf
    const ptParticleCount = Math.min(Math.floor(2 + bass * 3), 4);

    for (let i = 0; i < letters.length; i++) {
      const baseX = cx - totalW / 2 + i * ptAvgCharW + ptAvgCharW / 2;
      const baseY = cy;

      // Spawn particles from each letter position
      for (let p = 0; p < ptParticleCount; p++) {
        const seed = i * 100 + p;
        const px = baseX + Math.sin(time * 3 + seed) * dissolve * 200 * (settings.geoSpread || 1);
        const py = baseY + Math.cos(time * 2.3 + seed * 1.7) * dissolve * 150;
        const sizeScale = 0.3 + (1 - dissolve) * 0.7;
        const hue = (i / letters.length) * 360 + time * 40;
        const freqIdx = Math.floor((i / letters.length) * freqData.length * 0.3);
        const val = freqData[freqIdx] / 255;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(dissolve * Math.sin(time + seed) * 2);
        ctx.scale(sizeScale, sizeScale); // Use scale instead of per-particle font change
        ctx.fillStyle = `hsl(${hue}, 80%, ${50 + val * 40}%)`;
        ctx.globalAlpha = 0.3 + (1 - dissolve) * 0.7;
        drawStyledText(ctx, letters[i], 0, 0, settings);
        ctx.restore();
      }
    }
    ctx.restore();
    return;
  }

  // ==========================================
  // MODE: CIRCUIT TEXT (Letters connected by circuit-board lines)
  // ==========================================
  if (settings.textDisplayMode === 'circuit_text') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(20, settings.textFontSize * 2);
    const letters = text.replace(/\s/g, '').split('');

    // Initialize nodes if needed
    if (circuitNodes.length !== letters.length) {
      circuitNodes = letters.map((char, i) => ({
        x: (i / letters.length) * width * 0.8 + width * 0.1,
        y: height * 0.3 + (i % 3) * height * 0.2,
        char,
        connections: [Math.max(0, i - 1), Math.min(letters.length - 1, i + 1), (i + 3) % letters.length],
      }));
    }

    // Kill shadow for geometry (traces, boxes, pulses) — only re-enable for text
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    ctx.font = `700 ${baseFontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Animate positions
    for (let i = 0; i < circuitNodes.length; i++) {
      const node = circuitNodes[i];
      const freqIdx = Math.floor((i / circuitNodes.length) * freqData.length * 0.4);
      const val = freqData[freqIdx] / 255;
      node.x += Math.sin(time * 0.5 + i * 2) * 1.5;
      node.y += Math.cos(time * 0.3 + i * 1.7) * 1;
      // Keep in bounds
      node.x = Math.max(40, Math.min(width - 40, node.x));
      node.y = Math.max(40, Math.min(height - 40, node.y));

      // Draw connections (circuit traces) — no shadow
      ctx.lineWidth = 1 + val * 2;
      for (const ci of node.connections) {
        const target = circuitNodes[ci];
        if (!target) continue;

        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        // Right-angle routing like a PCB
        const midX = (node.x + target.x) / 2;
        ctx.lineTo(midX, node.y);
        ctx.lineTo(midX, target.y);
        ctx.lineTo(target.x, target.y);

        const hue = 120 + val * 60; // Green-ish circuit color
        ctx.strokeStyle = `hsla(${hue}, 80%, ${40 + val * 40}%, ${0.2 + val * 0.3})`;
        ctx.stroke();

        // Data pulse along connection
        const pulsePos = (time * 2 + i * 0.5) % 1;
        const pulseX = node.x + (target.x - node.x) * pulsePos;
        const pulseY = node.y + (target.y - node.y) * pulsePos;
        ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${val})`;
        ctx.fillRect(pulseX - 2, pulseY - 2, 4, 4);
      }

      // Draw letter node — no shadow on box geometry
      const hue = 120 + val * 120;
      ctx.globalAlpha = 0.6 + val * 0.4;

      // Node background
      ctx.fillStyle = `hsla(${hue}, 60%, 20%, 0.8)`;
      const boxSize = baseFontSize * 1.2;
      ctx.fillRect(node.x - boxSize / 2, node.y - boxSize / 2, boxSize, boxSize);
      ctx.strokeStyle = `hsl(${hue}, 80%, ${50 + val * 40}%)`;
      ctx.lineWidth = 1 + val;
      ctx.strokeRect(node.x - boxSize / 2, node.y - boxSize / 2, boxSize, boxSize);

      // Letter — brief glow only on the text itself
      ctx.shadowBlur = safeBlur(4 + val * 6);
      ctx.shadowColor = `hsl(${hue}, 80%, 60%)`;
      ctx.fillStyle = `hsl(${hue}, 80%, ${60 + val * 30}%)`;
      drawStyledText(ctx, node.char, node.x, node.y, settings);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  // ==========================================
  // MODE: FLAME TEXT (Text on fire, flames rise from letters)
  // ==========================================
  if (settings.textDisplayMode === 'flame_text') {
    const text = settings.customText ?? 'ELASTIC PRISM';
    const baseFontSize = Math.max(60, settings.textFontSize * 5);
    const pSize = Math.round(baseFontSize * 0.3); // fixed particle font size (1 font change instead of 300)

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cx = width / 2;
    const cy = height * 0.6;

    // Spawn flame particles — use totalW approximation (no per-char measureText)
    ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
    const totalW = ctx.measureText(text).width;
    const avgCharW = totalW / Math.max(1, text.length);

    // Add new particles (cap at 80 for Chrome perf with audio)
    if (flameParticles.length < 80) {
      for (let i = 0; i < text.length; i++) {
        if (Math.random() < 0.2 + bass * 0.35) {
          const baseX = cx - totalW / 2 + i * avgCharW + avgCharW / 2;
          flameParticles.push({
            x: baseX + (Math.random() - 0.5) * 15,
            y: cy - baseFontSize * 0.3,
            char: text[i],
            life: 1,
            vy: -(2 + Math.random() * 3 + bass * 4),
            vx: (Math.random() - 0.5) * 1.5,
          });
        }
      }
    }

    // Kill shadow for particles — only re-enable for main text
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // Draw all flame particles with ONE font size (avoid per-particle font change)
    ctx.font = `900 ${pSize}px ${fontFamily}`;
    let writeIdx = 0;
    for (let i = 0; i < flameParticles.length; i++) {
      const p = flameParticles[i];
      p.y += p.vy;
      p.x += p.vx + Math.sin(time * 8 + i) * 0.4;
      p.life -= 0.028;
      p.vy *= 0.97;

      if (p.life <= 0) continue;
      flameParticles[writeIdx++] = p; // compact in-place (no splice)

      const hue = 60 * p.life;
      const lightness = 50 + p.life * 40;
      ctx.globalAlpha = p.life * 0.5 * p.life; // quadratic fade
      ctx.fillStyle = `hsl(${hue | 0},100%,${lightness | 0}%)`;
      ctx.fillText(p.char, p.x, p.y);
    }
    flameParticles.length = writeIdx; // trim dead particles (O(1))

    // Draw main text (solid at bottom)
    ctx.font = `900 ${baseFontSize}px ${fontFamily}`;
    ctx.shadowBlur = safeBlur(8 + bass * 7);
    ctx.shadowColor = '#FF4400';
    ctx.fillStyle = `hsl(${(40 + bass * 20) | 0},100%,${(70 + bass * 20) | 0}%)`;
    ctx.globalAlpha = 0.9;
    drawStyledText(ctx, text, cx, cy, settings);

    // Reset shadow before second text pass
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#FFF8E0';
    ctx.globalAlpha = 0.35 + bass * 0.25;
    drawStyledText(ctx, text, cx, cy, settings);

    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  // ==========================================
  // ORIGINAL MODE: ASCII
  // ==========================================
  const fontSize = Math.max(6, settings.textFontSize || 14);
  const chars = settings.textCharacters.split('');
  const cellW = fontSize * 0.7;
  const cellH = fontSize * 1.1;
  const cols = Math.min(120, Math.floor(width / cellW));
  const rows = Math.min(60, Math.floor(height / cellH));

  if (cols <= 0 || rows <= 0) { ctx.restore(); return; }

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let y = 0; y < rows; y++) {
    const idx = Math.floor((y / rows) * freqData.length);
    const val = freqData[idx] / 255;
    const opacity = Math.max(0.05, Math.min(1, (0.1 + val * 0.9) * intensity));
    ctx.globalAlpha = opacity;
    ctx.fillStyle = val > 0.8 ? '#fff' : settings.colorPrimary;

    for (let x = 0; x < cols; x++) {
      const waveIdx = Math.floor((x / cols) * timeData.length);
      const waveVal = (timeData[waveIdx] - 128) / 128;

      const charIdx = Math.floor(val * (chars.length - 1));
      const char = chars[charIdx];

      const posX = x * cellW + cellW * 0.5;
      const posY = y * cellH + cellH * 0.5 + waveVal * 15 * intensity;

      drawStyledText(ctx, char, posX, posY, settings);
    }
  }
  ctx.globalAlpha = 1.0;
  ctx.restore();
};

const drawVortex = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const time = Date.now() * 0.001 * settings.speed;
  const bass = avgRange(data, 0, 10);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(time * settings.geoRotationSpeed);
  ctx.scale(settings.geoScale, settings.geoScale);

  const points = Math.floor(150 * settings.geoComplexity);
  const rotations = (5 + bass * 5) * settings.geoSymmetry;
  
  ctx.lineWidth = 2;
  
  for (let i = 0; i < points; i++) {
    const t = i / points;
    const angle = t * Math.PI * 2 * rotations + time;
    const freqIdx = Math.floor(t * data.length);
    const val = (data[freqIdx] / 255) || 0;
    
    const radius = t * Math.min(width, height) * 0.45 * (1 + val * 0.2 * settings.intensity);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    
    const size = 2 + val * 10 * settings.intensity;
    
    ctx.beginPath();
    ctx.fillStyle = i % 2 === 0 ? settings.colorPrimary : settings.colorSecondary;
    ctx.globalAlpha = 0.3 + val * 0.7;
    
    // Draw connecting lines occasionally
    if (i > 0 && i % 5 === 0) {
      ctx.strokeStyle = settings.colorPrimary;
      ctx.globalAlpha = 0.1 * val;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(0, 0);
      ctx.stroke();
    }
    
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    
    // Add a small glow to each point
    if (settings.bloom && val > 0.6) {
      ctx.shadowBlur = safeBlur(10 * val);
      ctx.shadowColor = settings.colorPrimary;
      ctx.fill();
    }
  }
  
  ctx.restore();
};

// Pre-built HSL→RGB lookup for plasma (avoids per-pixel string alloc)
const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  h = ((h % 360) + 360) % 360;
  s = s / 100;
  l = l / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [((r + m) * 255) | 0, ((g + m) * 255) | 0, ((b + m) * 255) | 0];
};

let plasmaImageData: ImageData | null = null;
let plasmaLastW = 0;
let plasmaLastH = 0;
let plasmaTmpCanvas: HTMLCanvasElement | null = null;
let plasmaTmpCtx: CanvasRenderingContext2D | null = null;

const drawPlasma = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = Date.now() * 0.001 * settings.speed;
  const bass = data.length > 10 ? avgRange(data, 0, 10) : 0;
  const mid = data.length > 100 ? avgRange(data, 30, 100) : 0;

  // Coarser grid = fewer pixels to compute (16px cells → ~120×68 = 8k ops instead of 14k)
  const gridSize = 16;
  const cols = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);

  // Reuse ImageData buffer (avoid GC)
  if (!plasmaImageData || plasmaLastW !== cols || plasmaLastH !== rows) {
    plasmaImageData = new ImageData(cols, rows);
    plasmaLastW = cols;
    plasmaLastH = rows;
  }
  const pixels = plasmaImageData.data;
  const hueShift = time * 20;
  const sat = 70 + bass * 30;

  for (let y = 0; y < rows; y++) {
    const ny = y * 0.05;
    const sinNyT = Math.sin(ny + time * 1.3);
    for (let x = 0; x < cols; x++) {
      const nx = x * 0.05;
      const v1 = Math.sin(nx + time);
      const v3 = Math.sin((nx + ny) * 0.7 + time * 0.7);
      const v4 = Math.sin(Math.sqrt(nx * nx + ny * ny) * 1.5 + time * 0.5);
      const v5 = Math.sin(nx * 0.5 + ny * 0.3 + time * 1.7) * bass * 2;

      const value = (v1 + sinNyT + v3 + v4 + v5) * 0.25;
      const hue = value * 120 + hueShift;
      const lightness = 30 + value * 25 + mid * 20;
      const alpha = Math.min(255, ((0.5 + bass * 0.4 + Math.abs(value) * 0.2) * 255) | 0);

      const [r, g, b] = hslToRgb(hue, sat, lightness);
      const idx = (y * cols + x) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = alpha;
    }
  }

  // Draw small ImageData then scale up (1 putImageData + 1 drawImage vs 14k fillRect)
  if (!plasmaTmpCanvas || plasmaTmpCanvas.width !== cols || plasmaTmpCanvas.height !== rows) {
    plasmaTmpCanvas = document.createElement('canvas');
    plasmaTmpCanvas.width = cols;
    plasmaTmpCanvas.height = rows;
    plasmaTmpCtx = plasmaTmpCanvas.getContext('2d');
  }
  plasmaTmpCtx!.putImageData(plasmaImageData, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(plasmaTmpCanvas, 0, 0, width, height);
  ctx.restore();

  // Overlay glow pulses on bass hits
  if (bass > 0.5) {
    ctx.save();
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.6);
    gradient.addColorStop(0, `${settings.colorPrimary}${Math.floor(bass * 40).toString(16).padStart(2, '0')}`);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
};

const drawStarfield = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings,
  starDataRef: React.MutableRefObject<{ x: number; y: number; z: number; seed: number }[] | null>
) => {
  const time = Date.now() * 0.001;
  const dt = settings.speed * 0.016;
  let bassAcc = 0; if (data.length > 10) { for (let i = 0; i < 10; i++) bassAcc += data[i]; } const bass = bassAcc / (10 * 255);
  const starCount = 200;
  const centerX = width / 2;
  const centerY = height / 2;

  // Initialize stars on first call
  if (!starDataRef.current || starDataRef.current.length !== starCount) {
    starDataRef.current = [];
    for (let i = 0; i < starCount; i++) {
      starDataRef.current.push({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z: Math.random(),
        seed: Math.random(),
      });
    }
  }

  // Speed multiplied by bass
  const speedMul = 1 + bass * 3;

  ctx.save();

  for (let i = 0; i < starCount; i++) {
    const star = starDataRef.current[i];

    // Move stars toward camera
    star.z -= dt * 0.5 * speedMul;
    if (star.z <= 0.01) {
      star.z = 1;
      star.x = (Math.random() - 0.5) * 2;
      star.y = (Math.random() - 0.5) * 2;
      star.seed = Math.random();
    }

    // 3D to 2D projection
    const sx = (star.x / star.z) * (width * 0.5) + centerX;
    const sy = (star.y / star.z) * (height * 0.5) + centerY;

    if (sx < -10 || sx > width + 10 || sy < -10 || sy > height + 10) {
      star.z = 1;
      star.x = (Math.random() - 0.5) * 2;
      star.y = (Math.random() - 0.5) * 2;
      continue;
    }

    const freqIdx = Math.floor(star.seed * Math.min(data.length, 128));
    const val = data[freqIdx] / 255;

    const radius = Math.max(0.5, (1 - star.z) * 4 * settings.intensity * (1 + val * 0.5));
    const alpha = (1 - star.z) * (0.4 + val * 0.6);

    // Draw star trail (only for close fast stars)
    if (speedMul > 0.5 && star.z < 0.5 && radius > 1.5) {
      ctx.globalAlpha = alpha * 0.25;
      ctx.fillStyle = settings.colorPrimary;
      const tx = (sx - centerX) * 0.03 * speedMul;
      const ty = (sy - centerY) * 0.03 * speedMul;
      ctx.fillRect(sx + tx, sy + ty, radius * 0.5, 1);
    }

    // Draw star point — fillRect for small stars, arc only for large ones
    ctx.globalAlpha = alpha;
    ctx.fillStyle = val > 0.7 ? '#FFFFFF' : settings.colorPrimary;
    if (radius < 1.5) {
      ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
};

const drawMetaballs = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = Date.now() * 0.001 * settings.speed;
  const ballCount = 6;
  const bass = data.length > 10 ? avgRange(data, 0, 10) : 0;
  const mid = data.length > 100 ? avgRange(data, 30, 100) : 0;

  // Calculate ball positions with Lissajous-like movement
  const balls: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < ballCount; i++) {
    const freqIdx = Math.floor((i / ballCount) * Math.min(data.length, 128));
    const val = data[freqIdx] / 255;
    const phase = (i / ballCount) * Math.PI * 2;

    const x = (Math.sin(time * 0.8 + phase) * Math.cos(time * 0.3 + i) * 0.35 + 0.5) * width;
    const y = (Math.cos(time * 0.6 + phase * 1.3) * Math.sin(time * 0.4 + i * 0.7) * 0.35 + 0.5) * height;
    const r = (30 + val * 80 * settings.intensity + bass * 40) * settings.particleSize;

    balls.push({ x, y, r });
  }

  // Use blur+contrast trick for smooth metaball merging
  ctx.save();
  // Reduced blur for performance (blur is extremely expensive)
  ctx.filter = `blur(10px) contrast(15)`;

  // Background for contrast filter to work
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);

  for (const ball of balls) {
    const gradient = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, ball.r);
    gradient.addColorStop(0, settings.colorPrimary);
    gradient.addColorStop(0.6, settings.colorPrimary);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Add secondary color highlights
  if (mid > 0.3) {
    ctx.save();
    ctx.globalAlpha = mid * 0.3;
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const ball = balls[i % balls.length];
      const gradient = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, ball.r * 0.5);
      gradient.addColorStop(0, settings.colorSecondary);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
};

const drawLissajous = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings,
  lissajousTrailRef: React.MutableRefObject<{ x: number; y: number }[]>
) => {
  const time = Date.now() * 0.001 * settings.speed;
  const bass = data.length > 10 ? avgRange(data, 0, 10) : 0;
  const mid = data.length > 100 ? avgRange(data, 30, 100) : 0;
  const centerX = width / 2;
  const centerY = height / 2;
  const size = Math.min(width, height) * 0.38;

  const a = 1 + bass * 3;
  const b = 2 + mid * 2.5;
  const delta = time * 0.5;

  ctx.save();
  ctx.translate(centerX, centerY);

  // Add current point to trail
  const trail = lissajousTrailRef.current;
  const tx = Math.sin(a * time * 0.5 + delta) * size;
  const ty = Math.sin(b * time * 0.5) * size;
  trail.push({ x: tx, y: ty });
  if (trail.length > 256) { trail.copyWithin(0, trail.length - 256); trail.length = 256; }

  // Draw trail with gradient fade
  if (trail.length > 2) {
    for (let i = 1; i < trail.length; i++) {
      const progress = i / trail.length;
      const alpha = progress * (0.4 + bass * 0.6);

      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.strokeStyle = progress < 0.5 ? settings.colorSecondary : settings.colorPrimary;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.5 + progress * 3 + bass * 2;
      ctx.stroke();
    }
  }

  // Draw the full parametric curve as overlay
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = settings.colorPrimary;
  ctx.beginPath();

  const points = 300;
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * Math.PI * 2;
    const freqIdx = Math.floor((i / points) * Math.min(data.length, 128));
    const val = data[freqIdx] / 255;

    const x = Math.sin(a * t + delta) * size * (1 + val * 0.15 * settings.intensity);
    const y = Math.sin(b * t) * size * (1 + val * 0.15 * settings.intensity);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Glow at current position
  ctx.globalAlpha = 0.8 + bass * 0.2;
  const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, 15 + bass * 20);
  glow.addColorStop(0, settings.colorPrimary);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(tx, ty, 15 + bass * 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.globalAlpha = 1;
};

const drawDNA = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = Date.now() * 0.001 * settings.speed;
  const bass = data.length > 10 ? avgRange(data, 0, 10) : 0;
  const centerX = width / 2;
  const points = 60;
  const spacing = (height + 40) / points;
  const amplitude = Math.min(width * 0.2, 150) * (1 + bass * 0.5);

  ctx.save();
  ctx.translate(centerX, -20);

  // Draw connecting rungs first (behind backbones)
  for (let i = 0; i < points; i++) {
    const y = i * spacing;
    const freqIdx = Math.floor((i / points) * Math.min(data.length, 128));
    const val = data[freqIdx] / 255;

    const angle = i * 0.25 + time * 2;
    const x1 = Math.sin(angle) * amplitude * (1 + val * settings.intensity * 0.3);
    const x2 = Math.sin(angle + Math.PI) * amplitude * (1 + val * settings.intensity * 0.3);

    // Depth effect: rungs behind vs in front
    const depth = Math.cos(angle); // -1 to 1, determines "rotation"
    const rungAlpha = 0.1 + Math.abs(depth) * 0.3 + val * 0.2;

    // Color rungs by frequency band
    const bandColors = ['#FF4444', '#44FF44', '#4444FF', '#FFFF44'];
    const colorIdx = Math.floor((i / points) * bandColors.length) % bandColors.length;

    ctx.beginPath();
    ctx.strokeStyle = bandColors[colorIdx];
    ctx.globalAlpha = rungAlpha;
    ctx.lineWidth = 1.5 + val * 2;
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
  }

  // Draw backbone strands as smooth curves
  for (let strand = 0; strand < 2; strand++) {
    const phaseOffset = strand * Math.PI;
    const color = strand === 0 ? settings.colorPrimary : settings.colorSecondary;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;

    for (let i = 0; i < points; i++) {
      const y = i * spacing;
      const freqIdx = Math.floor((i / points) * Math.min(data.length, 128));
      const val = data[freqIdx] / 255;
      const angle = i * 0.25 + time * 2 + phaseOffset;
      const x = Math.sin(angle) * amplitude * (1 + val * settings.intensity * 0.3);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw backbone nodes
    for (let i = 0; i < points; i++) {
      const y = i * spacing;
      const freqIdx = Math.floor((i / points) * Math.min(data.length, 128));
      const val = data[freqIdx] / 255;
      const angle = i * 0.25 + time * 2 + phaseOffset;
      const x = Math.sin(angle) * amplitude * (1 + val * settings.intensity * 0.3);
      const nodeSize = 3 + val * 8;

      ctx.globalAlpha = 0.6 + val * 0.4;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y, nodeSize, 0, Math.PI * 2);
      ctx.fill();

      // Glow on high values
      if (val > 0.6 && settings.bloom) {
        ctx.shadowBlur = safeBlur(10 * val);
        ctx.shadowColor = color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  ctx.restore();
  ctx.globalAlpha = 1;
};

/** Frequency Territory Wars: frequency bands fight for screen space */
const drawTerritory = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = Date.now() * 0.001 * settings.speed;
  const len = Math.min(data.length, 256);

  // Split into 3 bands
  let bassE = 0, midE = 0, highE = 0;
  for (let i = 0; i < 20; i++) bassE += data[i] / 255;
  for (let i = 20; i < 100; i++) midE += data[i] / 255;
  for (let i = 100; i < len; i++) highE += data[i] / 255;
  bassE /= 20; midE /= 80; highE /= Math.max(1, len - 100);

  const total = bassE + midE + highE + 0.01;
  const bassH = (bassE / total) * height;
  const midH = (midE / total) * height;

  const bassY = height - bassH;
  const midY = bassY - midH;

  // Bass zone (bottom) - fluid waves
  ctx.save();
  ctx.fillStyle = settings.colorPrimary;
  for (let x = 0; x < width; x += 4) {
    const wave = Math.sin(x * 0.02 + time * 2) * 20 * bassE;
    ctx.globalAlpha = 0.3 + bassE * 0.5;
    ctx.fillRect(x, height - bassH - wave, 4, bassH + wave);
  }

  // Bass-Mid border glow
  const g1 = ctx.createLinearGradient(0, bassY - 20, 0, bassY + 20);
  g1.addColorStop(0, 'transparent');
  g1.addColorStop(0.5, `${settings.colorPrimary}88`);
  g1.addColorStop(1, 'transparent');
  ctx.fillStyle = g1;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(0, bassY - 20, width, 40);
  ctx.restore();

  // Mid zone (middle) - geometric bars
  ctx.save();
  const segs = Math.floor(16 * settings.geoComplexity);
  ctx.globalAlpha = 0.3 + midE * 0.5;
  for (let i = 0; i < segs; i++) {
    const x = (i / segs) * width;
    const freqIdx = Math.floor((i / segs) * 80) + 20;
    const val = data[freqIdx] / 255;
    const barH = val * midH * settings.intensity;
    ctx.fillStyle = i % 2 === 0 ? settings.colorPrimary : settings.colorSecondary;
    ctx.fillRect(x, bassY - barH, width / segs - 2, barH);
  }

  // Mid-High border glow
  const g2 = ctx.createLinearGradient(0, midY - 15, 0, midY + 15);
  g2.addColorStop(0, 'transparent');
  g2.addColorStop(0.5, `${settings.colorSecondary}88`);
  g2.addColorStop(1, 'transparent');
  ctx.fillStyle = g2;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(0, midY - 15, width, 30);
  ctx.restore();

  // High zone (top) - sparkle particles
  ctx.save();
  ctx.globalAlpha = 0.4 + highE * 0.6;
  const sparks = Math.floor(40 * highE * settings.geoComplexity);
  for (let i = 0; i < sparks; i++) {
    const sx = (Math.sin(i * 7.3 + time * 3) * 0.5 + 0.5) * width;
    const sy = Math.random() * Math.max(10, midY);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(sx, sy, 1 + highE * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

// ─── RINGS — Concentric audio-reactive rings ──────────────────────────
const drawRings = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = performance.now() * 0.001 * settings.speed;
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) * 0.45;
  const ringCount = Math.floor(20 * settings.geoComplexity);
  const intensity = settings.intensity || 1;

  // Audio bands
  const len = data.length;
  const bass = avgRange(data, 0, len >> 3);
  const mid = avgRange(data, len >> 2, len >> 1);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * settings.geoRotationSpeed * 0.3);

  for (let i = 0; i < ringCount; i++) {
    const t = i / ringCount;
    const freqIdx = Math.floor(t * data.length * 0.8);
    const val = (data[freqIdx] || 0) / 255;
    const r = maxR * (0.1 + t * 0.9) * (1 + val * 0.15 * intensity);

    // Ring deformation — breathing with bass
    const wobble = bass * 8 * settings.geoTurbulence;

    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2; a += 0.05) {
      const deform = 1 + Math.sin(a * settings.geoSymmetry + time * 2 + i) * wobble * 0.05;
      const px = Math.cos(a) * r * deform;
      const py = Math.sin(a) * r * deform;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    const hue = (t * 360 + time * 30 * settings.colorCycleSpeed) % 360;
    ctx.strokeStyle = settings.colorCycleSpeed > 0
      ? `hsla(${hue}, 80%, 60%, ${0.15 + val * 0.6})`
      : `${settings.colorPrimary}${Math.floor((0.15 + val * 0.6) * 255).toString(16).padStart(2, '0')}`;
    ctx.lineWidth = 1 + val * 3 * settings.geoScale;
    ctx.stroke();

    // Glow on loud rings
    if (val > 0.6) {
      ctx.shadowBlur = safeBlur(8 + val * 7);
      ctx.shadowColor = settings.colorPrimary;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
  ctx.restore();

  // Center pulse on bass
  ctx.save();
  ctx.globalAlpha = bass * 0.6;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.2 * (1 + bass));
  grad.addColorStop(0, settings.colorPrimary);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * 0.2 * (1 + bass), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

// ─── GRID WARP — Audio-deformed wireframe grid ────────────────────────
const drawGridWarp = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = performance.now() * 0.001 * settings.speed;
  const cols = Math.floor(24 * settings.geoComplexity);
  const rows = Math.floor(16 * settings.geoComplexity);
  const cellW = width / cols;
  const cellH = height / rows;
  const intensity = settings.intensity || 1;

  const len = data.length;
  const bass = avgRange(data, 0, len >> 3);

  // Build displaced grid points
  const points: { x: number; y: number; val: number }[][] = [];
  for (let r = 0; r <= rows; r++) {
    points[r] = [];
    for (let c = 0; c <= cols; c++) {
      const baseX = c * cellW;
      const baseY = r * cellH;
      const freqIdx = Math.floor((c / cols) * data.length * 0.7);
      const val = (data[freqIdx] || 0) / 255;

      // Displacement: wave propagation from center
      const dx = (c / cols - 0.5) * 2;
      const dy = (r / rows - 0.5) * 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const wave = Math.sin(dist * 6 - time * 3 + bass * 4) * settings.geoTurbulence * 20;
      const freqWave = val * 15 * intensity * settings.geoScale;

      points[r][c] = {
        x: baseX + wave * dx + Math.sin(time + r * 0.5) * freqWave * 0.3,
        y: baseY + wave * dy + freqWave * Math.cos(time * 0.7 + c * 0.3),
        val,
      };
    }
  }

  ctx.save();

  // Draw horizontal lines
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const p = points[r][c];
      if (c === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    const rowVal = points[r][Math.floor(cols / 2)].val;
    ctx.strokeStyle = `${settings.colorPrimary}${Math.floor((0.15 + rowVal * 0.5) * 255).toString(16).padStart(2, '0')}`;
    ctx.lineWidth = 0.5 + rowVal * 2;
    ctx.stroke();
  }

  // Draw vertical lines
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    for (let r = 0; r <= rows; r++) {
      const p = points[r][c];
      if (r === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    const colVal = points[Math.floor(rows / 2)][c].val;
    ctx.strokeStyle = `${settings.colorSecondary}${Math.floor((0.1 + colVal * 0.4) * 255).toString(16).padStart(2, '0')}`;
    ctx.lineWidth = 0.5 + colVal * 1.5;
    ctx.stroke();
  }

  // Highlight intersections where energy is high
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const p = points[r][c];
      if (p.val > 0.55) {
        ctx.fillStyle = settings.colorPrimary;
        ctx.globalAlpha = p.val * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 + p.val * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
};

// ─── CHRYSANTHEMUM — Audio-reactive flower petal pattern ──────────────
const drawChrysanthemum = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = performance.now() * 0.001 * settings.speed;
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) * 0.42;
  const intensity = settings.intensity || 1;
  const petalCount = Math.floor(settings.geoSymmetry * 2) || 8;
  const layers = Math.floor(6 * settings.geoComplexity);

  const len = data.length;
  const bass = avgRange(data, 0, len >> 3);
  const mid = avgRange(data, len >> 2, len >> 1);
  const high = avgRange(data, len >> 1, (len * 3) >> 2);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * settings.geoRotationSpeed * 0.2);

  for (let layer = 0; layer < layers; layer++) {
    const lt = layer / layers;
    const layerR = maxR * (0.2 + lt * 0.8);
    const freqBand = Math.floor(lt * data.length * 0.6);
    const val = (data[freqBand] || 0) / 255;
    const petalWidth = (0.3 + val * 0.5) * settings.geoScale;
    const rotOffset = lt * 0.3 + time * 0.1 * (layer % 2 === 0 ? 1 : -1);

    for (let p = 0; p < petalCount; p++) {
      const angle = (p / petalCount) * Math.PI * 2 + rotOffset;
      const petalR = layerR * (0.6 + val * 0.4 * intensity) * (1 + bass * 0.2);

      ctx.beginPath();
      // Petal shape: bezier curves
      const tipX = Math.cos(angle) * petalR;
      const tipY = Math.sin(angle) * petalR;
      const perpAngle = angle + Math.PI / 2;
      const spread = petalWidth * layerR * 0.15;
      const cp1x = Math.cos(angle) * petalR * 0.5 + Math.cos(perpAngle) * spread;
      const cp1y = Math.sin(angle) * petalR * 0.5 + Math.sin(perpAngle) * spread;
      const cp2x = Math.cos(angle) * petalR * 0.5 - Math.cos(perpAngle) * spread;
      const cp2y = Math.sin(angle) * petalR * 0.5 - Math.sin(perpAngle) * spread;

      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(cp1x, cp1y, tipX, tipY);
      ctx.quadraticCurveTo(cp2x, cp2y, 0, 0);

      const hue = (lt * 60 + p * 15 + time * 20 * settings.colorCycleSpeed) % 360;
      const alpha = 0.1 + val * 0.35;
      ctx.fillStyle = settings.colorCycleSpeed > 0
        ? `hsla(${hue}, 75%, 55%, ${alpha})`
        : `${settings.colorPrimary}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
      ctx.fill();

      // Bright edge on loud petals
      if (val > 0.5) {
        ctx.strokeStyle = `${settings.colorSecondary}${Math.floor(val * 0.5 * 255).toString(16).padStart(2, '0')}`;
        ctx.lineWidth = 0.5 + val;
        ctx.stroke();
      }
    }
  }

  // Center orb — pulses with bass
  const orbR = 10 + bass * 30 * settings.geoScale;
  const orbGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, orbR);
  orbGrad.addColorStop(0, settings.colorPrimary);
  orbGrad.addColorStop(0.6, settings.colorSecondary);
  orbGrad.addColorStop(1, 'transparent');
  ctx.globalAlpha = 0.6 + bass * 0.4;
  ctx.fillStyle = orbGrad;
  ctx.beginPath();
  ctx.arc(0, 0, orbR, 0, Math.PI * 2);
  ctx.fill();

  // Stamen dots — high frequency sparkles
  ctx.globalAlpha = high * 0.8;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + time;
    const r = 15 + Math.sin(i * 3.7 + time * 2) * 10;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1 + high * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

// ─── OSCILLOSCOPE — Classic XY Lissajous oscilloscope ─────────────────
const drawOscilloscope = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings,
  timeData: Uint8Array
) => {
  const time = performance.now() * 0.001 * settings.speed;
  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) * 0.38 * settings.geoScale;
  const intensity = settings.intensity || 1;

  const len = data.length;
  const bass = avgRange(data, 0, len >> 3);

  ctx.save();

  // CRT-style dark green phosphor background glow
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.5);
  bgGrad.addColorStop(0, `${settings.colorPrimary}08`);
  bgGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Graticule (scope grid)
  ctx.strokeStyle = `${settings.colorPrimary}15`;
  ctx.lineWidth = 0.5;
  const gridDiv = 8;
  for (let i = 1; i < gridDiv; i++) {
    const gx = cx - scale + (i / gridDiv) * scale * 2;
    const gy = cy - scale + (i / gridDiv) * scale * 2;
    ctx.beginPath(); ctx.moveTo(gx, cy - scale); ctx.lineTo(gx, cy + scale); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - scale, gy); ctx.lineTo(cx + scale, gy); ctx.stroke();
  }
  // Cross hairs
  ctx.strokeStyle = `${settings.colorPrimary}25`;
  ctx.beginPath(); ctx.moveTo(cx - scale, cy); ctx.lineTo(cx + scale, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - scale); ctx.lineTo(cx, cy + scale); ctx.stroke();

  // XY mode: timeData as X, frequency data as Y
  const sampleCount = Math.min(timeData.length, data.length, 512);
  const freqRatio = settings.geoSymmetry || 2;
  const phaseShift = time * settings.geoRotationSpeed;

  // Draw beam trace with phosphor glow
  ctx.beginPath();
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    // X: time-domain waveform
    const xVal = (timeData[i] / 128.0 - 1.0);
    // Y: phase-shifted time domain (simulates dual-channel scope)
    const yIdx = Math.floor((i + sampleCount * 0.25 * freqRatio) % sampleCount);
    const yVal = (timeData[yIdx] / 128.0 - 1.0);

    const x = cx + xVal * scale * intensity * Math.cos(phaseShift) - yVal * scale * 0.3 * Math.sin(phaseShift);
    const y = cy + yVal * scale * intensity * Math.cos(phaseShift) + xVal * scale * 0.3 * Math.sin(phaseShift);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  // Phosphor glow effect — draw twice with different widths
  ctx.shadowBlur = safeBlur(8 + bass * 7);
  ctx.shadowColor = settings.colorPrimary;
  ctx.strokeStyle = settings.colorPrimary;
  ctx.lineWidth = 1.5 + bass * 2;
  ctx.globalAlpha = 0.8;
  ctx.stroke();

  // Bright core
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.4 + bass * 0.3;
  ctx.stroke();

  // Beam dot at current position (like a real CRT)
  const lastIdx = sampleCount - 1;
  const dotX = cx + (timeData[lastIdx] / 128.0 - 1.0) * scale * intensity;
  const dotY = cy + (timeData[Math.floor((lastIdx + sampleCount * 0.25) % sampleCount)] / 128.0 - 1.0) * scale * intensity;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowBlur = MAX_SHADOW;
  ctx.shadowColor = settings.colorPrimary;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 2 + bass * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// ─── SMOKE — Fluid smoke tendrils driven by audio ─────────────────────
const smokeParticlesPool: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; hue: number }[] = [];
let smokeInitialized = false;

const drawSmoke = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  width: number,
  height: number,
  settings: VisualizerSettings
) => {
  const time = performance.now() * 0.001 * settings.speed;
  const intensity = settings.intensity || 1;

  const len = data.length;
  const bass = avgRange(data, 0, len >> 3);
  const mid = avgRange(data, len >> 2, len >> 1);
  const high = avgRange(data, len >> 1, (len * 3) >> 2);

  const maxParticles = Math.floor(200 * settings.geoComplexity);

  // Initialize pool
  if (!smokeInitialized || smokeParticlesPool.length < maxParticles * 0.5) {
    smokeInitialized = true;
    smokeParticlesPool.length = 0;
    for (let i = 0; i < maxParticles; i++) {
      smokeParticlesPool.push({
        x: width * 0.3 + Math.random() * width * 0.4,
        y: height + Math.random() * 50,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.5 - Math.random() * 1.5,
        life: Math.random(),
        maxLife: 0.6 + Math.random() * 0.4,
        size: 20 + Math.random() * 40,
        hue: Math.random() * 60,
      });
    }
  }

  ctx.save();

  // Subtle background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, `${settings.colorSecondary}08`);
  bgGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Update and draw particles
  for (let i = 0; i < smokeParticlesPool.length; i++) {
    const p = smokeParticlesPool[i];

    // Update
    p.life += 0.003 + bass * 0.005;

    if (p.life >= p.maxLife) {
      // Respawn at bottom — emitter positions driven by frequency
      const emitterX = width * 0.2 + (i % 5) * width * 0.15;
      p.x = emitterX + (Math.random() - 0.5) * 30;
      p.y = height + 10;
      p.life = 0;
      p.maxLife = 0.5 + Math.random() * 0.5;
      p.vx = (Math.random() - 0.5) * 0.3;
      p.vy = -1 - Math.random() * 2 - bass * 2;
      p.size = 15 + Math.random() * 35 * settings.geoScale;
      p.hue = Math.random() * 60;
    }

    // Physics — turbulence from audio
    const turbX = Math.sin(p.y * 0.01 + time * 2) * settings.geoTurbulence * 0.5;
    const turbY = Math.cos(p.x * 0.01 + time * 1.5) * settings.geoTurbulence * 0.3;
    p.vx += turbX * 0.02 + (mid - 0.3) * 0.1;
    p.vy += turbY * 0.01 - 0.02; // gentle upward drift
    p.vx *= 0.99; // damping
    p.vy *= 0.99;

    p.x += p.vx * (1 + bass * 2);
    p.y += p.vy * (1 + bass);

    // Draw
    const t = p.life / p.maxLife;
    const alpha = Math.sin(t * Math.PI) * 0.25 * intensity; // fade in/out
    const size = p.size * (0.5 + t * 1.5) * (1 + bass * 0.5);

    if (alpha < 0.01 || !isFinite(p.x) || !isFinite(p.y)) continue;

    ctx.globalAlpha = alpha;

    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
    if (settings.colorCycleSpeed > 0) {
      const hue = (p.hue + time * 30 * settings.colorCycleSpeed) % 360;
      grad.addColorStop(0, `hsla(${hue}, 40%, 60%, 0.8)`);
      grad.addColorStop(0.4, `hsla(${hue}, 30%, 40%, 0.3)`);
      grad.addColorStop(1, 'transparent');
    } else {
      grad.addColorStop(0, `${settings.colorPrimary}CC`);
      grad.addColorStop(0.4, `${settings.colorSecondary}44`);
      grad.addColorStop(1, 'transparent');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // High-frequency embers rising through smoke
  ctx.globalAlpha = high * 0.7;
  for (let i = 0; i < 15; i++) {
    const ex = width * 0.3 + Math.sin(i * 4.7 + time * 1.5) * width * 0.25;
    const ey = height - (time * 40 + i * 50) % height;
    const eSize = 1 + high * 3;
    ctx.fillStyle = settings.colorPrimary;
    ctx.beginPath();
    ctx.arc(ex, ey, eSize, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
};
