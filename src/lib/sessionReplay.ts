/**
 * Session Replay - Records visual parameter changes as a compact timeline
 * and can replay them deterministically.
 */

import { VisualizerSettings } from '../types';

interface ReplayFrame {
  t: number; // timestamp in ms since start
  s: Partial<VisualizerSettings>; // only changed settings (delta)
}

let recording = false;
let frames: ReplayFrame[] = [];
let startTime = 0;
let lastSnapshot: Partial<VisualizerSettings> = {};

const RECORD_INTERVAL = 200; // capture every 200ms
const TRACKED_KEYS: (keyof VisualizerSettings)[] = [
  'mode', 'colorPrimary', 'colorSecondary', 'masterIntensity', 'intensity',
  'geoScale', 'geoRotationSpeed', 'geoSymmetry', 'geoSegments',
  'geoSpread', 'geoDepth', 'geoTurbulence', 'geoComplexity',
  'bloom', 'glitch', 'feedback', 'vignette', 'hueRotation',
  'layer2Mode', 'layer2BlendMode', 'layer2Opacity',
  'fluidParticlesEnabled', 'strobeEnabled',
];

export function startRecording(): void {
  recording = true;
  frames = [];
  startTime = Date.now();
  lastSnapshot = {};
}

export function stopRecording(): ReplayFrame[] {
  recording = false;
  return frames;
}

export function isRecordingSession(): boolean {
  return recording;
}

export function captureFrame(settings: VisualizerSettings): void {
  if (!recording) return;
  const now = Date.now() - startTime;

  // Only record deltas
  const delta: Partial<VisualizerSettings> = {};
  let hasChanges = false;
  for (const key of TRACKED_KEYS) {
    if (settings[key] !== lastSnapshot[key]) {
      (delta as Record<string, unknown>)[key] = settings[key];
      (lastSnapshot as Record<string, unknown>)[key] = settings[key];
      hasChanges = true;
    }
  }

  if (hasChanges) {
    frames.push({ t: now, s: delta });
  }
}

export function exportSession(): string {
  return JSON.stringify({
    version: 1,
    duration: frames.length > 0 ? frames[frames.length - 1].t : 0,
    frameCount: frames.length,
    frames,
  }, null, 2);
}

export function importSession(json: string): ReplayFrame[] {
  const data = JSON.parse(json);
  return data.frames || [];
}

/** Get the settings overrides at a given playback time */
export function getReplayFrame(replayFrames: ReplayFrame[], timeMs: number): Partial<VisualizerSettings> {
  const result: Partial<VisualizerSettings> = {};
  for (const frame of replayFrames) {
    if (frame.t > timeMs) break;
    Object.assign(result, frame.s);
  }
  return result;
}
