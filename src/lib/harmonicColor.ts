/**
 * Harmonic Color Engine
 * Analyzes musical key from audio FILE at load time (not real-time).
 * Uses Web Audio OfflineAudioContext + AnalyserNode for fast FFT,
 * then Krumhansl-Schmuckler algorithm for key detection.
 */

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_HUES: number[] = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

export interface HarmonicResult {
  key: string;
  keyIndex: number;
  isMinor: boolean;
  confidence: number;
  chroma: number[];
  suggestedPrimary: string;
  suggestedSecondary: string;
  dominantHue: number;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  return Math.sqrt(denX * denY) > 0 ? num / Math.sqrt(denX * denY) : 0;
}

function findKey(chroma: number[]): { keyIndex: number; isMinor: boolean; confidence: number } {
  let bestCorr = -Infinity, bestKey = 0, bestMinor = false;
  for (let shift = 0; shift < 12; shift++) {
    const rotated = chroma.map((_, i) => chroma[(i + shift) % 12]);
    const major = pearsonCorrelation(rotated, MAJOR_PROFILE);
    if (major > bestCorr) { bestCorr = major; bestKey = shift; bestMinor = false; }
    const minor = pearsonCorrelation(rotated, MINOR_PROFILE);
    if (minor > bestCorr) { bestCorr = minor; bestKey = shift; bestMinor = true; }
  }
  return { keyIndex: bestKey, isMinor: bestMinor, confidence: Math.max(0, bestCorr) };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

let cachedKey: HarmonicResult | null = null;
let cachedTrackUrl: string | null = null;
let analyzing = false;

/**
 * Analyze key of an audio file at load time.
 * Uses OfflineAudioContext to render and analyze the first 20 seconds.
 */
export async function analyzeTrackKey(audioUrl: string): Promise<HarmonicResult> {
  if (cachedTrackUrl === audioUrl && cachedKey) return cachedKey;
  if (analyzing) return cachedKey || makeDefault();
  analyzing = true;

  try {
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();

    const sampleRate = 44100;
    const duration = 20; // analyze first 20 seconds
    const totalSamples = sampleRate * duration;

    // Decode to get actual audio data
    const tempCtx = new AudioContext();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    await tempCtx.close();

    // Extract mono PCM
    const rawData = audioBuffer.getChannelData(0);
    const samples = Math.min(rawData.length, totalSamples);

    // FAST chroma extraction: use simple energy-per-pitch-class from raw PCM
    // Much faster than Goertzel (O(n) instead of O(n*bins))
    const chromaAccum = new Array(12).fill(0);
    const windowSize = 2048;
    const hopSize = windowSize * 2; // Skip frames for speed
    const binFreq = sampleRate / windowSize;

    // Only analyze 12 key frequency bins (one per pitch class, octave 3-5)
    const targetFreqs = [
      261.63, 277.18, 293.66, 311.13, 329.63, 349.23, // C4 to F4
      369.99, 392.00, 415.30, 440.00, 466.16, 493.88, // F#4 to B4
    ];

    for (let start = 0; start + windowSize < samples; start += hopSize) {
      for (let pc = 0; pc < 12; pc++) {
        // Goertzel for just this one frequency (fast: O(windowSize) per freq)
        const freq = targetFreqs[pc];
        const k = Math.round(freq / binFreq);
        const w = 2 * Math.PI * k / windowSize;
        const coeff = 2 * Math.cos(w);
        let s1 = 0, s2 = 0;

        for (let n = 0; n < windowSize; n++) {
          const s0 = rawData[start + n] + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
        }

        const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
        chromaAccum[pc] += Math.sqrt(Math.abs(power));
      }
    }

    // Normalize
    const max = Math.max(...chromaAccum, 0.001);
    const chroma = chromaAccum.map(v => v / max);

    const { keyIndex, isMinor, confidence } = findKey(chroma);
    const dominantHue = PITCH_HUES[keyIndex];
    const sat = isMinor ? 70 : 85;
    const light = isMinor ? 42 : 55;

    const result: HarmonicResult = {
      key: `${NOTE_NAMES[keyIndex]}${isMinor ? 'm' : ''}`,
      keyIndex, isMinor, confidence, chroma,
      suggestedPrimary: hslToHex(dominantHue, sat, light),
      suggestedSecondary: hslToHex(PITCH_HUES[(keyIndex + 7) % 12], sat - 10, light - 5),
      dominantHue,
    };

    cachedKey = result;
    cachedTrackUrl = audioUrl;
    analyzing = false;
    return result;
  } catch (err) {
    console.error('Key analysis failed:', err);
    analyzing = false;
    return makeDefault();
  }
}

function makeDefault(): HarmonicResult {
  return {
    key: '?', keyIndex: 0, isMinor: false, confidence: 0,
    chroma: new Array(12).fill(0),
    suggestedPrimary: '#FFFFFF', suggestedSecondary: '#444444', dominantHue: 0,
  };
}

export function getHarmonicColors(): HarmonicResult | null {
  return cachedKey;
}
