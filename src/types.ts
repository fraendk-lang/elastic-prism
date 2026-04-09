export type VisualizerMode = 'bars' | 'wave' | 'circle' | 'particles' | 'matrix' | 'prism3d' | 'kaleidoscope' | 'tunnel' | 'text' | 'vortex' | 'cyberflow' | 'plasma' | 'starfield' | 'metaballs' | 'lissajous' | 'dna' | 'fractal_zoom' | 'fluid_sim' | 'aurora' | 'quantum_field' | 'neural_net' | 'territory' | 'glitch_city' | 'cosmic_web' | 'electric_storm' | 'rings' | 'grid_warp' | 'chrysanthemum' | 'oscilloscope' | 'smoke';

export type HandGesture = 'none' | 'pinch' | 'fist' | 'open_palm' | 'point' | 'wave';

export interface HandUpdate {
  x: number;
  y: number;
  active: boolean;
  gesture: HandGesture;
  pinchDistance: number;
  fingers: boolean[];
}

export interface PlaylistItem {
  id: string;
  file: File;
  name: string;
  url: string;
}

export interface UserPreset {
  id: string;
  name: string;
  settings: Partial<VisualizerSettings>;
  createdAt: number;
}

export type BlendMode = 'source-over' | 'screen' | 'multiply' | 'overlay' | 'difference' | 'exclusion';

export type AutomationCurve = 'sine' | 'ramp' | 'sawtooth' | 'random' | 'pulse';
export type LfoShape = 'sine' | 'triangle' | 'square' | 'saw';

export interface LfoConfig {
  shape: LfoShape;
  rate: number;      // Hz (0.1-20)
  depth: number;     // 0-1
  target: string;    // settings key
  enabled: boolean;
}

export interface AutomationLane {
  param: string;
  curve: AutomationCurve;
  min: number;
  max: number;
  speed: number; // cycles per song
  enabled: boolean;
}

export interface VisualizerSettings {
  mode: VisualizerMode;
  secondaryMode: VisualizerMode | 'none';
  blendMode: BlendMode;
  masterIntensity: number;
  sensitivity: number;
  smoothing: number;
  colorPrimary: string;
  colorSecondary: string;
  barWidth: number;
  showGrid: boolean;
  intensity: number;
  bloom: boolean;
  glitch: boolean;
  feedback: boolean;
  feedbackTarget: 'primary' | 'secondary' | 'both';
  vignette: boolean;
  noise: number;
  mirror: boolean;
  kaleidoscope: boolean;
  kaleidoscopeSegments: number;
  scanlines: boolean;
  chromaticAberration: number;
  distortion: number;
  // New Features 2026
  beatSync: boolean;
  backgroundUrl: string | null;
  backgroundType: 'image' | 'video' | 'none';
  backgroundBlur: number;
  backgroundOpacity: number;
  backgroundSaturate: number;
  mouseInteraction: boolean;
  gestureControl: boolean;
  showCameraPreview: boolean;
  // Text Mode Settings
  textDisplayMode: 'ascii' | 'readable' | 'shatter' | 'liquid' | 'glitch_matrix' | 'gravity_well' | 'typestorm' | 'echo_chamber' | 'waveform_text' | 'neon_sign' | 'kinetic_type' | 'mirror_text' | 'spectrum_letters' | 'particle_text' | 'circuit_text' | 'flame_text';
  textOverlayEnabled: boolean;
  customText: string;
  textArtist: string;          // artist name (shown below title)
  textFontSize: number;
  textSpeed: number;
  textCharacters: string;
  textFont: 'mono' | 'sans' | 'serif' | 'display' | 'handwriting' | 'pixel';
  textBlendMode: 'source-over' | 'screen' | 'multiply' | 'overlay' | 'difference' | 'exclusion' | 'lighter' | 'color-dodge';
  textGlow: number;        // 0-1 glow intensity
  textStroke: boolean;     // outline only (no fill)
  textShadowColor: string; // shadow/glow color
  textLetterSpacing: number; // -5 to 20
  textRotation: number;   // global rotation 0-360
  speed: number;
  // Visual Modulation Macros
  hueRotation: number;
  colorCycleSpeed: number;
  waveAmplitude: number;
  waveFrequency: number;
  particleSize: number;
  particleLife: number;
  glitchIntensity: number;
  bloomThreshold: number;
  bloomRadius: number;
  // Layer 2 (independent second visual)
  layer2Mode: VisualizerMode | 'none';
  layer2BlendMode: BlendMode;
  layer2Opacity: number;
  // 8 Geometry Macros
  geoScale: number;
  geoRotationSpeed: number;
  geoSymmetry: number;
  geoSegments: number;
  geoSpread: number;
  geoDepth: number;
  geoTurbulence: number;
  geoComplexity: number;
  // Fluid Particles Overlay
  fluidParticlesEnabled: boolean;
  fluidParticleCount: number;
  fluidParticleSize: number;
  // Visual Automation
  automationEnabled: boolean;
  // Pro Features
  sweepEnabled: boolean;
  // LFO
  lfoEnabled: boolean;
  // Layer 2 Colors (independent)
  layer2ColorPrimary: string;
  layer2ColorSecondary: string;
  // Stroboscope
  strobeEnabled: boolean;
  strobeSpeed: number;
  strobeType: 'bw' | 'color' | 'geometric' | 'invert';
  // Harmonic Color Engine
  harmonicColorEnabled: boolean;
  // Transition Morph Engine
  transitionMorphEnabled: boolean;
  // NDI Virtual Output
  ndiOutputEnabled: boolean;
  // Export Fade
  fadeInDuration: number;    // seconds (0 = no fade)
  fadeOutDuration: number;   // seconds (0 = no fade)
}

export type TimelineActionType = 'preset' | 'setting' | 'action';

export interface TimelineMarker {
  id: string;
  time: number;           // seconds into the track
  type: TimelineActionType;
  label: string;
  // For 'preset': full partial settings to apply
  preset?: Partial<VisualizerSettings>;
  // For 'setting': single key/value change
  settingKey?: keyof VisualizerSettings;
  settingValue?: VisualizerSettings[keyof VisualizerSettings];
  // For 'action': pro action trigger
  action?: 'hit' | 'cut' | 'clear';
}

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  fileName: string | null;
  playlist: PlaylistItem[];
  currentIndex: number;
}
