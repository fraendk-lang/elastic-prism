/**
 * Transition Morph Engine
 * Detects musical transitions (buildup, drop, breakdown) from audio features
 * and suggests visual parameter changes.
 */

export type TransitionPhase = 'idle' | 'buildup' | 'drop' | 'breakdown' | 'steady';

export interface TransitionState {
  phase: TransitionPhase;
  intensity: number;      // 0-1, how deep into this phase
  dropProbability: number; // 0-1, likelihood a drop is coming
  energy: number;         // overall energy level
}

// Internal state
let energyHistory: number[] = [];
let spectralFluxHistory: number[] = [];
let prevSpectrum: number[] = [];
let currentPhase: TransitionPhase = 'idle';
let phaseTimer = 0;
let smoothedEnergy = 0;
let smoothedFlux = 0;
let peakEnergy = 0;
let troughEnergy = 1;

const HISTORY_SIZE = 128; // ~2-3 seconds at 60fps
const SMOOTH_ALPHA = 0.1;

export function analyzeTransition(freqData: Uint8Array): TransitionState {
  if (freqData.length === 0) return { phase: 'idle', intensity: 0, dropProbability: 0, energy: 0 };

  // Calculate current energy (weighted toward bass)
  let energy = 0;
  let bassEnergy = 0;
  const len = Math.min(freqData.length, 256);
  for (let i = 0; i < len; i++) {
    const weight = i < 20 ? 3 : i < 60 ? 1.5 : 1;
    energy += (freqData[i] / 255) * weight;
    if (i < 20) bassEnergy += freqData[i] / 255;
  }
  energy /= len;
  bassEnergy /= 20;

  // Calculate spectral flux (change in spectrum)
  const spectrum = Array.from(freqData).slice(0, len).map(v => v / 255);
  let flux = 0;
  if (prevSpectrum.length === spectrum.length) {
    for (let i = 0; i < spectrum.length; i++) {
      const diff = spectrum[i] - prevSpectrum[i];
      if (diff > 0) flux += diff; // Only positive flux (onset)
    }
  }
  prevSpectrum = spectrum;

  // Smooth values
  smoothedEnergy += (energy - smoothedEnergy) * SMOOTH_ALPHA;
  smoothedFlux += (flux - smoothedFlux) * SMOOTH_ALPHA;

  // Track history
  energyHistory.push(smoothedEnergy);
  spectralFluxHistory.push(smoothedFlux);
  if (energyHistory.length > HISTORY_SIZE) energyHistory.shift();
  if (spectralFluxHistory.length > HISTORY_SIZE) spectralFluxHistory.shift();

  // Calculate energy trend (rising = buildup, falling = breakdown)
  const recentEnergy = energyHistory.slice(-20);
  const olderEnergy = energyHistory.slice(-60, -20);
  const recentAvg = recentEnergy.length > 0 ? recentEnergy.reduce((a, b) => a + b, 0) / recentEnergy.length : 0;
  const olderAvg = olderEnergy.length > 0 ? olderEnergy.reduce((a, b) => a + b, 0) / olderEnergy.length : recentAvg;

  const trend = recentAvg - olderAvg; // positive = rising, negative = falling

  // Track peaks and troughs
  if (smoothedEnergy > peakEnergy) peakEnergy = smoothedEnergy;
  else peakEnergy *= 0.999; // slow decay
  if (smoothedEnergy < troughEnergy) troughEnergy = smoothedEnergy;
  else troughEnergy += 0.001; // slow rise

  const energyRange = Math.max(0.01, peakEnergy - troughEnergy);
  const normalizedEnergy = (smoothedEnergy - troughEnergy) / energyRange;

  // Phase detection with hysteresis
  phaseTimer++;
  const prevPhase = currentPhase;

  // Drop detection: sudden energy spike after low period
  const isDropCandidate = flux > 0.15 && bassEnergy > 0.6 && trend > 0.02;

  // Buildup: steadily rising energy + rising spectral flux
  const isBuildupCandidate = trend > 0.005 && normalizedEnergy < 0.7 && normalizedEnergy > 0.2;

  // Breakdown: very low energy after high
  const isBreakdownCandidate = normalizedEnergy < 0.3 && peakEnergy > 0.3;

  // State machine with minimum phase duration (prevent flickering)
  const minPhaseDuration = 30; // ~0.5 seconds

  if (phaseTimer > minPhaseDuration) {
    if (isDropCandidate && currentPhase !== 'drop') {
      currentPhase = 'drop';
      phaseTimer = 0;
    } else if (isBuildupCandidate && currentPhase !== 'buildup' && currentPhase !== 'drop') {
      currentPhase = 'buildup';
      phaseTimer = 0;
    } else if (isBreakdownCandidate && currentPhase !== 'breakdown') {
      currentPhase = 'breakdown';
      phaseTimer = 0;
    } else if (!isDropCandidate && !isBuildupCandidate && !isBreakdownCandidate) {
      currentPhase = normalizedEnergy > 0.4 ? 'steady' : 'idle';
    }
  }

  // Drop probability: predict drops from buildup pattern
  let dropProbability = 0;
  if (currentPhase === 'buildup') {
    dropProbability = Math.min(1, phaseTimer / 120); // Increases over buildup duration
  }

  return {
    phase: currentPhase,
    intensity: normalizedEnergy,
    dropProbability,
    energy: smoothedEnergy,
  };
}

/** Get visual parameter suggestions based on current transition phase */
export function getTransitionOverrides(state: TransitionState): Record<string, number> {
  switch (state.phase) {
    case 'buildup':
      return {
        geoComplexity: 0.5 + state.intensity * 2,
        geoTurbulence: state.intensity * 1.5,
        bloomRadius: 0.5 + state.intensity,
        speed: 1 + state.intensity * 0.5,
      };
    case 'drop':
      return {
        geoScale: 1.5 + state.intensity * 0.5,
        glitchIntensity: 0.3 + state.intensity * 0.5,
        bloomRadius: 2,
        geoRotationSpeed: 2 + state.intensity * 2,
        masterIntensity: 1.5,
      };
    case 'breakdown':
      return {
        geoScale: 0.7,
        geoTurbulence: 0.1,
        geoComplexity: 0.5,
        bloomRadius: 0.3,
        speed: 0.5 + state.intensity * 0.3,
        masterIntensity: 0.6 + state.intensity * 0.3,
      };
    case 'steady':
      return {
        speed: 1,
        masterIntensity: 1,
      };
    default:
      return {};
  }
}
