import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, Mic, Upload,
  Hand, Camera,
  RotateCcw, Trash2, Plus, Music,
  MousePointer2, Save, Download as DownloadIcon, Upload as UploadIcon
} from 'lucide-react';
import { VisualizerSettings, AudioState, VisualizerMode, UserPreset, TimelineMarker } from '../types';
import type { MidiMapping } from '../lib/midiLearn';

// ─── Types ──────────────────────────────────────────────────────────
interface AudioControlsProps {
  audioState: AudioState;
  settings: VisualizerSettings;
  onTogglePlay: () => void;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  onModeChange: (mode: VisualizerMode) => void;
  onSettingChange: (key: keyof VisualizerSettings, value: VisualizerSettings[keyof VisualizerSettings]) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleMic: () => void;
  isMicActive: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSelectTrack: (index: number) => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  exportQuality: '720p' | '1080p' | '4k';
  onExportQualityChange: (q: '720p' | '1080p' | '4k') => void;
  onApplyPreset: (preset: Partial<VisualizerSettings>) => void;
  onReset: () => void;
  getFrequencyData: () => Uint8Array;
  getTimeDomainData: () => Uint8Array;
  mousePos?: { x: number; y: number };
  // Auto Presets
  autoPresetEnabled: boolean;
  autoPresetInterval: number;
  onAutoPresetToggle: () => void;
  onAutoPresetIntervalChange: (v: number) => void;
  // Timeline
  timelineMarkers: TimelineMarker[];
  timelineRecording: boolean;
  onTimelineRecordToggle: () => void;
  onTimelineAddMarker: (marker: Omit<TimelineMarker, 'id'>) => void;
  onTimelineRemoveMarker: (id: string) => void;
  onTimelineNudgeMarker: (id: string, delta: number) => void;
  onTimelineClear: () => void;
  midiEnabled: boolean;
  midiDevices: string[];
  midiMappings: MidiMapping[];
  midiLearningTarget: string | null;
  midiError: string | null;
  onMidiEnableToggle: () => void;
  onMidiLearnStart: (param: string) => void;
  onMidiLearnCancel: () => void;
  onMidiRemoveMapping: (cc: number, channel: number) => void;
}

type SC = (key: keyof VisualizerSettings, value: VisualizerSettings[keyof VisualizerSettings]) => void;

// ─── Constants (module-level, zero alloc per render) ────────────────
const MODE_LABELS: { id: VisualizerMode; label: string }[] = [
  { id: 'bars', label: 'Spectrum' }, { id: 'wave', label: 'Wave' }, { id: 'circle', label: 'Orbit' },
  { id: 'particles', label: 'Nebula' }, { id: 'matrix', label: 'Grid' }, { id: 'prism3d', label: '3D' },
  { id: 'kaleidoscope', label: 'Kaleido' }, { id: 'tunnel', label: 'Tunnel' }, { id: 'text', label: 'Text' },
  { id: 'vortex', label: 'Vortex' }, { id: 'cyberflow', label: 'Flow' }, { id: 'plasma', label: 'Plasma' },
  { id: 'starfield', label: 'Stars' }, { id: 'metaballs', label: 'Liquid' }, { id: 'lissajous', label: 'Lissajous' },
  { id: 'dna', label: 'DNA' }, { id: 'fractal_zoom', label: 'Fractal' }, { id: 'fluid_sim', label: 'Fluid' },
  { id: 'aurora', label: 'Aurora' }, { id: 'quantum_field', label: 'Quantum' }, { id: 'neural_net', label: 'Neural' },
  { id: 'territory', label: 'Territory' }, { id: 'glitch_city', label: 'GlitchCity' }, { id: 'cosmic_web', label: 'Cosmic' },
  { id: 'electric_storm', label: 'Storm' }, { id: 'rings', label: 'Rings' }, { id: 'grid_warp', label: 'GridWarp' },
  { id: 'chrysanthemum', label: 'Flower' }, { id: 'oscilloscope', label: 'Scope' }, { id: 'smoke', label: 'Smoke' },
];

const PRESET_DEFINITIONS: { name: string; settings: Partial<VisualizerSettings> }[] = [
  { name: 'Techno', settings: { mode: 'tunnel', secondaryMode: 'vortex', colorPrimary: '#39FF14', colorSecondary: '#02080A', bloom: true, glitch: false, chromaticAberration: 0.25, beatSync: true, speed: 1.9, intensity: 1.3, masterIntensity: 1.25, geoRotationSpeed: 2.4, geoDepth: 1.7, waveAmplitude: 1.15 } },
  { name: 'Ambient', settings: { mode: 'particles', secondaryMode: 'circle', feedbackTarget: 'primary', colorPrimary: '#00AAFF', bloom: true, feedback: true, smoothing: 0.95, beatSync: false } },
  { name: 'Retro', settings: { mode: 'matrix', secondaryMode: 'wave', feedbackTarget: 'secondary', colorPrimary: '#FF00FF', noise: 0.5, vignette: true, chromaticAberration: 0.3, beatSync: true } },
  { name: 'Cyber', settings: { mode: 'prism3d', secondaryMode: 'none', colorPrimary: '#FFFF00', bloom: true, glitch: true, chromaticAberration: 0.8, beatSync: true } },
  { name: 'Liquid', settings: { mode: 'text', textDisplayMode: 'liquid', colorPrimary: '#00FFAA', colorSecondary: '#0044FF', textFont: 'display', textGlow: 0.8, textShadowColor: '#00FFAA', textBlendMode: 'screen', beatSync: true, customText: 'LIQUID', textSpeed: 0.8 } },
  { name: 'Deep Sea', settings: { mode: 'wave', secondaryMode: 'particles', colorPrimary: '#0044FF', colorSecondary: '#001144', smoothing: 0.98, intensity: 0.5, bloom: true, beatSync: false } },
  { name: 'Supernova', settings: { mode: 'circle', secondaryMode: 'particles', colorPrimary: '#FFD700', colorSecondary: '#FF4500', intensity: 1.5, bloom: true, glitch: true, beatSync: true } },
  { name: 'Cyberpunk', settings: { mode: 'matrix', secondaryMode: 'prism3d', colorPrimary: '#FF00FF', colorSecondary: '#00FFFF', glitch: true, chromaticAberration: 1.0, beatSync: true, noise: 0.2 } },
  { name: 'Ethereal', settings: { mode: 'kaleidoscope', secondaryMode: 'particles', colorPrimary: '#FFFFFF', colorSecondary: '#AA00FF', smoothing: 0.9, feedback: true, bloom: true, beatSync: false } },
  { name: 'Datastream', settings: { mode: 'text', textDisplayMode: 'typestorm', textFont: 'mono', textBlendMode: 'difference', customText: 'DATASTREAM', textSpeed: 1.8, textGlow: 0.45, textLetterSpacing: 2, textRotation: 0, colorPrimary: '#37FFD5', colorSecondary: '#0A1620', chromaticAberration: 0.2, scanlines: true, beatSync: true } },
  // Text Presets
  { name: 'Inferno', settings: { mode: 'text', textDisplayMode: 'flame_text', colorPrimary: '#FF4400', textFont: 'display', textGlow: 0.9, textShadowColor: '#FF4400', textBlendMode: 'lighter', beatSync: true, customText: 'FIRE' } },
  { name: 'Hacker', settings: { mode: 'text', textDisplayMode: 'circuit_text', colorPrimary: '#00FF41', textFont: 'mono', textGlow: 0.6, textShadowColor: '#00FF41', textBlendMode: 'screen', beatSync: true, customText: 'ELASTIC PRISM' } },
  { name: 'Kinetic', settings: { mode: 'text', textDisplayMode: 'kinetic_type', colorPrimary: '#FFFFFF', textFont: 'display', textGlow: 0.4, textBlendMode: 'lighter', beatSync: true, customText: 'DROP THE BASS', textSpeed: 1.5 } },
  { name: 'Mandala', settings: { mode: 'text', textDisplayMode: 'mirror_text', colorPrimary: '#FF00FF', textFont: 'serif', textGlow: 0.7, textShadowColor: '#AA00FF', geoSymmetry: 6, beatSync: true, customText: 'PRISM' } },
  { name: 'Dissolve', settings: { mode: 'text', textDisplayMode: 'particle_text', colorPrimary: '#00CCFF', textFont: 'sans', textGlow: 0.5, textBlendMode: 'screen', beatSync: true, customText: 'ELASTIC', geoSpread: 1.5 } },
  { name: 'EQ Type', settings: { mode: 'text', textDisplayMode: 'spectrum_letters', colorPrimary: '#FFD700', textFont: 'display', textGlow: 0.3, textBlendMode: 'lighter', beatSync: true, customText: 'FREQUENCY' } },
  { name: 'Neon Club', settings: { mode: 'text', textDisplayMode: 'neon_sign', colorPrimary: '#FF0080', colorSecondary: '#00FFCC', textFont: 'display', textGlow: 1.0, textShadowColor: '#FF0080', textBlendMode: 'screen', beatSync: true, customText: 'CLUB' } },
  { name: 'Gravity', settings: { mode: 'text', textDisplayMode: 'gravity_well', colorPrimary: '#8844FF', textFont: 'mono', textGlow: 0.6, textBlendMode: 'lighter', beatSync: true, customText: 'ORBIT' } },
  { name: 'Pulse Grid', settings: { mode: 'grid_warp', secondaryMode: 'oscilloscope', colorPrimary: '#00E5FF', colorSecondary: '#101826', bloom: true, beatSync: true, speed: 1.4, waveFrequency: 2.2, waveAmplitude: 1.4, scanlines: true, chromaticAberration: 0.15 } },
  { name: 'Midnight Run', settings: { mode: 'text', textDisplayMode: 'echo_chamber', textFont: 'mono', textBlendMode: 'screen', customText: 'MIDNIGHT RUN', colorPrimary: '#7C9BFF', colorSecondary: '#110B1F', textGlow: 0.55, textSpeed: 1.2, textLetterSpacing: 3, beatSync: true, vignette: true } },
];

// Presets should not auto-enable feedback unless explicitly desired.
export const PRESETS: { name: string; settings: Partial<VisualizerSettings> }[] = PRESET_DEFINITIONS.map((preset) => ({
  ...preset,
  settings: {
    ...preset.settings,
    feedback: false,
  },
}));

const BLEND_MODES = ['screen', 'multiply', 'overlay', 'difference', 'exclusion'] as const;

const GEO_MACROS = [
  { id: 'geoScale', label: 'Scl', min: 0.1, max: 3, step: 0.05 },
  { id: 'geoRotationSpeed', label: 'Rot', min: 0, max: 5, step: 0.1 },
  { id: 'geoSymmetry', label: 'Sym', min: 1, max: 16, step: 1 },
  { id: 'geoSegments', label: 'Seg', min: 3, max: 128, step: 1 },
  { id: 'geoSpread', label: 'Spr', min: 0.1, max: 5, step: 0.1 },
  { id: 'geoDepth', label: 'Dep', min: 0.1, max: 5, step: 0.1 },
  { id: 'geoTurbulence', label: 'Trb', min: 0, max: 2, step: 0.05 },
  { id: 'geoComplexity', label: 'Cpx', min: 0.1, max: 3, step: 0.05 },
] as const;

const FX_BUTTONS = [
  { id: 'beatSync', label: 'Beat' }, { id: 'bloom', label: 'Bloom' }, { id: 'glitch', label: 'Glitch' },
  { id: 'feedback', label: 'Fdbk' }, { id: 'kaleidoscope', label: 'Kalei' }, { id: 'scanlines', label: 'Scan' },
  { id: 'vignette', label: 'Vign' }, { id: 'mirror', label: 'Mirr' }, { id: 'fluidParticlesEnabled', label: 'Part' },
  { id: 'textOverlayEnabled', label: 'TxtOv' },
  { id: 'automationEnabled', label: 'Auto' }, { id: 'strobeEnabled', label: 'Strb' }, { id: 'harmonicColorEnabled', label: 'Harm' },
  { id: 'transitionMorphEnabled', label: 'Morph' }, { id: 'ndiOutputEnabled', label: 'Stream' },
  { id: 'sweepEnabled', label: 'Swp' }, { id: 'lfoEnabled', label: 'LFO' },
] as const;

const MOD_MACROS = [
  { id: 'hueRotation', label: 'Hue Rotation', min: 0, max: 360, step: 1 },
  { id: 'colorCycleSpeed', label: 'Cycle Speed', min: 0, max: 5, step: 0.1 },
  { id: 'waveAmplitude', label: 'Amplitude', min: 0, max: 5, step: 0.1 },
  { id: 'waveFrequency', label: 'Frequency', min: 0.1, max: 10, step: 0.1 },
  { id: 'particleSize', label: 'Particle Size', min: 0.5, max: 10, step: 0.1 },
  { id: 'glitchIntensity', label: 'Glitch Int.', min: 0, max: 1, step: 0.01 },
] as const;

const TEXT_MODES = [
  { id: 'shatter', label: 'Shatter' }, { id: 'liquid', label: 'Liquid' }, { id: 'glitch_matrix', label: 'Glitch' },
  { id: 'gravity_well', label: 'Gravity' }, { id: 'typestorm', label: 'Storm' }, { id: 'echo_chamber', label: 'Echo' },
  { id: 'waveform_text', label: 'Wave' }, { id: 'neon_sign', label: 'Neon' }, { id: 'readable', label: 'Readable' },
  { id: 'kinetic_type', label: 'Kinetic' }, { id: 'mirror_text', label: 'Mirror' },
  { id: 'spectrum_letters', label: 'Spectrum' }, { id: 'particle_text', label: 'Particle' },
  { id: 'circuit_text', label: 'Circuit' }, { id: 'flame_text', label: 'Flame' },
] as const;

const TEXT_FONTS = [
  { id: 'mono', label: 'Mono' }, { id: 'sans', label: 'Sans' }, { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' }, { id: 'handwriting', label: 'Hand' }, { id: 'pixel', label: 'Pixel' },
] as const;

const TEXT_BLENDS = [
  { id: 'source-over', label: 'Normal' }, { id: 'screen', label: 'Screen' }, { id: 'lighter', label: 'Add' },
  { id: 'multiply', label: 'Multi' }, { id: 'overlay', label: 'Over' }, { id: 'difference', label: 'Diff' },
  { id: 'exclusion', label: 'Excl' }, { id: 'color-dodge', label: 'Dodge' },
] as const;

// ─── Sub-sections (each independently memoized) ─────────────────────

const SectionHeader = ({ title }: { title: string }) => (
  <h3 className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#8B6914]/60">{title}</h3>
);

/** Transport: Play/Pause, Volume, File Open, Mic */
const TransportSection = React.memo<{
  audioState: AudioState; isMicActive: boolean;
  onTogglePlay: () => void; onVolumeChange: (v: number) => void; onToggleMute: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; onToggleMic: () => void;
  onNext: () => void; onPrev: () => void;
}>(({ audioState, isMicActive, onTogglePlay, onVolumeChange, onToggleMute, onFileUpload, onToggleMic, onNext, onPrev }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="p-2 border-b border-[#8B6914]/20">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#8B6914]/60">Transport</span>
      </div>
      <div className="flex gap-1 mb-1">
        <button onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-white/5 border border-white/10 text-[8px] font-bold uppercase hover:bg-white/10 transition-colors text-white/50">
          <Upload size={10} /> Open
        </button>
        <input ref={fileInputRef} type="file" multiple accept="audio/*" onChange={onFileUpload} className="hidden" />
        <button onClick={onToggleMic}
          className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded border text-[8px] font-bold uppercase transition-colors ${
            isMicActive ? 'bg-red-500/20 border-red-500/30 text-red-400' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
          }`}>
          <Mic size={10} /> {isMicActive ? 'Live' : 'Mic'}
        </button>
      </div>
      <div className="text-[8px] font-mono text-white/30 truncate">{audioState.fileName || 'no file loaded'}</div>
      <div className="flex items-center gap-1 mt-1">
        <button onClick={onPrev} className="p-0.5 hover:bg-white/5 rounded text-white/40"><SkipBack size={12} /></button>
        <button onClick={onTogglePlay} className="p-1 bg-white/10 rounded hover:bg-white/20 transition-colors">
          {audioState.isPlaying ? <Pause size={12} fill="white" /> : <Play size={12} fill="white" className="ml-0.5" />}
        </button>
        <button onClick={onNext} className="p-0.5 hover:bg-white/5 rounded text-white/40"><SkipForward size={12} /></button>
        <div className="flex items-center gap-1 flex-1 ml-1">
          <button onClick={onToggleMute} className="text-white/30"><Volume2 size={10} /></button>
          <input type="range" min="0" max="1" step="0.01" value={audioState.volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-full h-0.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#D4A537]" />
        </div>
      </div>
    </div>
  );
});

/** Colors: Primary + Secondary pickers */
const ColorsSection = React.memo<{ cp: string; cs: string; sc: SC }>(({ cp, cs, sc }) => (
  <section className="space-y-4">
    <SectionHeader title="Colors" />
    <div className="flex gap-3">
      <label className="flex-1 flex items-center gap-2">
        <input type="color" value={cp} onChange={(e) => sc('colorPrimary', e.target.value)}
          className="w-8 h-8 rounded-lg border border-white/10 bg-transparent cursor-pointer appearance-none" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Primary</span>
      </label>
      <label className="flex-1 flex items-center gap-2">
        <input type="color" value={cs} onChange={(e) => sc('colorSecondary', e.target.value)}
          className="w-8 h-8 rounded-lg border border-white/10 bg-transparent cursor-pointer appearance-none" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Secondary</span>
      </label>
    </div>
  </section>
));

/** Layer 2 */
const Layer2Section = React.memo<{
  l2mode: VisualizerMode | 'none'; l2blend: string; l2opacity: number;
  l2cp: string; l2cs: string; sc: SC;
}>(({ l2mode, l2blend, l2opacity, l2cp, l2cs, sc }) => (
  <section className="space-y-4">
    <div className="flex items-center justify-between">
      <SectionHeader title="Layer 2" />
      {l2mode !== 'none' && (
        <button onClick={() => sc('layer2Mode', 'none')} className="text-[10px] font-mono text-red-400 hover:text-red-300">OFF</button>
      )}
    </div>
    <div className="grid grid-cols-3 gap-1">
      {MODE_LABELS.map((m) => (
        <button key={`l2-${m.id}`} onClick={() => sc('layer2Mode', m.id)}
          className={`px-1.5 py-1.5 rounded-lg border text-[8px] font-bold uppercase tracking-wider transition-all ${
            l2mode === m.id ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/5 text-white/30 hover:bg-white/10'
          }`}>{m.label}</button>
      ))}
    </div>
    {l2mode !== 'none' && (
      <div className="space-y-3">
        <div className="flex gap-3">
          <label className="flex-1 flex items-center gap-2">
            <input type="color" value={l2cp} onChange={(e) => sc('layer2ColorPrimary', e.target.value)}
              className="w-6 h-6 rounded border border-white/10 bg-transparent cursor-pointer appearance-none" />
            <span className="text-[8px] font-bold uppercase text-white/40">Primary</span>
          </label>
          <label className="flex-1 flex items-center gap-2">
            <input type="color" value={l2cs} onChange={(e) => sc('layer2ColorSecondary', e.target.value)}
              className="w-6 h-6 rounded border border-white/10 bg-transparent cursor-pointer appearance-none" />
            <span className="text-[8px] font-bold uppercase text-white/40">Secondary</span>
          </label>
        </div>
        <div className="flex gap-1">
          {BLEND_MODES.map((bm) => (
            <button key={bm} onClick={() => sc('layer2BlendMode', bm)}
              className={`flex-1 py-1 rounded text-[8px] font-bold uppercase transition-all ${
                l2blend === bm ? 'bg-white/20 text-white' : 'bg-white/5 text-white/30 hover:bg-white/10'
              }`}>{bm.slice(0, 4)}</button>
          ))}
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Opacity</span>
            <span className="text-[10px] font-mono text-white/30">{l2opacity.toFixed(1)}</span>
          </div>
          <input type="range" min="0" max="1" step="0.05" value={l2opacity}
            onChange={(e) => sc('layer2Opacity', parseFloat(e.target.value))}
            className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-white" />
        </div>
      </div>
    )}
  </section>
));

/** Geometry sliders */
const GeoSection = React.memo<{ settings: VisualizerSettings; sc: SC }>(({ settings, sc }) => (
  <section className="space-y-2">
    <SectionHeader title="Geometry" />
    <div className="space-y-1">
      {GEO_MACROS.map((macro) => {
        const val = settings[macro.id as keyof VisualizerSettings] as number;
        return (
          <div key={macro.id} className="flex items-center gap-2">
            <label className="text-[8px] font-bold uppercase text-white/40 w-7 shrink-0">{macro.label}</label>
            <input type="range" min={macro.min} max={macro.max} step={macro.step} value={val}
              onChange={(e) => sc(macro.id as keyof VisualizerSettings, parseFloat(e.target.value))}
              className="flex-1 h-0.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#D4A537]" />
            <span className="text-[7px] font-mono text-white/30 w-5 text-right shrink-0">{val.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  </section>
), (prev, next) => {
  // Only re-render if a geo value actually changed
  for (const m of GEO_MACROS) {
    if (prev.settings[m.id as keyof VisualizerSettings] !== next.settings[m.id as keyof VisualizerSettings]) return false;
  }
  return true;
});

/** FX toggle buttons */
const FxSection = React.memo<{ settings: VisualizerSettings; sc: SC }>(({ settings, sc }) => (
  <section className="space-y-2">
    <SectionHeader title="FX" />
    <div className="flex flex-wrap gap-1">
      {FX_BUTTONS.map((fx) => (
        <button key={fx.id}
          onClick={() => sc(fx.id as keyof VisualizerSettings, !settings[fx.id as keyof VisualizerSettings])}
          className={`px-2 py-1 rounded text-[8px] font-bold uppercase transition-all ${
            settings[fx.id as keyof VisualizerSettings]
              ? 'bg-[#8B6914]/30 text-[#D4A537] border border-[#8B6914]/50'
              : 'bg-white/5 text-white/30 hover:bg-white/10 border border-transparent'
          }`}>{fx.label}</button>
      ))}
    </div>
  </section>
), (prev, next) => {
  for (const fx of FX_BUTTONS) {
    if (prev.settings[fx.id as keyof VisualizerSettings] !== next.settings[fx.id as keyof VisualizerSettings]) return false;
  }
  return true;
});

/** Presets (built-in + user) */
const PresetsSection = React.memo<{
  onApplyPreset: (p: Partial<VisualizerSettings>) => void;
  settings: VisualizerSettings;
}>(({ onApplyPreset, settings }) => {
  const [userPresets, setUserPresets] = useState<UserPreset[]>(() => {
    try { const s = localStorage.getItem('prism_user_presets'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem('prism_user_presets', JSON.stringify(userPresets)); }, [userPresets]);

  const save = () => {
    if (!name.trim() || userPresets.length >= 20) return;
    setUserPresets(p => [...p, { id: Math.random().toString(36).substr(2, 9), name: name.trim(), settings: { ...settings }, createdAt: Date.now() }]);
    setName(''); setShowSave(false);
  };

  return (
    <>
      <section className="space-y-4">
        <SectionHeader title="Presets" />
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button key={p.name} onClick={() => onApplyPreset(p.settings)}
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 transition-colors text-white/60">{p.name}</button>
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader title="My Presets" />
          <div className="flex items-center gap-1">
            <button onClick={() => { const j = JSON.stringify(userPresets, null, 2); const b = new Blob([j], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'prism-presets.json'; a.click(); URL.revokeObjectURL(u); }}
              className="p-1 hover:bg-white/5 rounded text-white/30 hover:text-white/60 transition-colors" title="Export"><DownloadIcon size={12} /></button>
            <button onClick={() => importRef.current?.click()}
              className="p-1 hover:bg-white/5 rounded text-white/30 hover:text-white/60 transition-colors" title="Import"><UploadIcon size={12} /></button>
            <input ref={importRef} type="file" accept=".json" onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const r = new FileReader(); r.onload = (ev) => { try { const i = JSON.parse(ev.target?.result as string); setUserPresets(p => [...p, ...i].slice(0, 20)); } catch {} }; r.readAsText(f); e.target.value = '';
            }} className="hidden" />
            <button onClick={() => setShowSave(!showSave)}
              className="p-1 hover:bg-white/5 rounded text-white/30 hover:text-white/60 transition-colors" title="Save"><Save size={12} /></button>
          </div>
        </div>
        {showSave && (
          <div className="flex gap-2">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="Preset name..." className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] text-white placeholder-white/30 outline-none focus:border-white/30" maxLength={30} autoFocus />
            <button onClick={save} className="px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-[10px] font-bold uppercase hover:bg-white/20 transition-colors">Save</button>
          </div>
        )}
        {userPresets.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {userPresets.map((p) => (
              <div key={p.id} className="relative group">
                <button onClick={() => onApplyPreset(p.settings)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 transition-colors text-white/60 text-left truncate">{p.name}</button>
                <button onClick={() => setUserPresets(prev => prev.filter(x => x.id !== p.id))}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 rounded-full items-center justify-center text-[8px] text-white opacity-0 group-hover:opacity-100 transition-opacity hidden group-hover:flex">x</button>
              </div>
            ))}
          </div>
        ) : <p className="text-[10px] text-white/20 italic">No saved presets yet</p>}
      </section>
    </>
  );
}, () => true); // Presets section never needs to re-render from parent (has own state)

/** Text mode selector with full creative controls — collapsible */
const TextSection = React.memo<{
  textDisplayMode: string; customText: string; textArtist: string; textFont: string; textBlendMode: string;
  textGlow: number; textStroke: boolean; textShadowColor: string;
  textLetterSpacing: number; textRotation: number; textFontSize: number; textSpeed: number; sc: SC;
}>(({ textDisplayMode, customText, textArtist, textFont, textBlendMode, textGlow, textStroke, textShadowColor,
  textLetterSpacing, textRotation, textFontSize, textSpeed, sc }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="space-y-2">
      {/* Header row: always visible — shows current sub-mode + expand toggle */}
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between">
        <SectionHeader title="Text Engine" />
        <div className="flex items-center gap-2">
          <span className="text-[8px] font-bold uppercase text-[#D4A537]">{textDisplayMode.replace('_', ' ')}</span>
          <span className="text-[8px] text-white/30">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Sub-Mode row: always visible (compact, 1 row scrollable) */}
      <div className="grid grid-cols-4 gap-1">
        {TEXT_MODES.map((tm) => (
          <button key={tm.id} onClick={() => sc('textDisplayMode', tm.id)}
            className={`px-1 py-1 rounded text-[7px] font-bold uppercase transition-all ${
              textDisplayMode === tm.id ? 'bg-[#8B6914]/30 text-[#D4A537] border border-[#8B6914]/50' : 'bg-white/5 text-white/25 hover:bg-white/10 border border-transparent'
            }`}>{tm.label}</button>
        ))}
      </div>

      {/* Custom Text: always visible */}
      <input type="text" value={customText} onChange={(e) => sc('customText', e.target.value)}
        placeholder="Title"
        className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] text-white placeholder-white/20 outline-none focus:border-white/30" />
      <input type="text" value={textArtist} onChange={(e) => sc('textArtist', e.target.value)}
        placeholder="Artist"
        className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] text-white/60 placeholder-white/15 outline-none focus:border-white/30" />

      {/* Advanced controls: only when expanded */}
      {expanded && (
        <div className="space-y-2 pt-1 border-t border-white/5">
          {/* Font */}
          <div className="grid grid-cols-3 gap-1">
            {TEXT_FONTS.map((f) => (
              <button key={f.id} onClick={() => sc('textFont', f.id)}
                className={`py-1 rounded text-[7px] font-bold uppercase transition-all ${
                  textFont === f.id ? 'bg-[#8B6914]/30 text-[#D4A537] border border-[#8B6914]/50' : 'bg-white/5 text-white/30 hover:bg-white/10 border border-transparent'
                }`}>{f.label}</button>
            ))}
          </div>

          {/* Blend */}
          <div className="grid grid-cols-4 gap-1">
            {TEXT_BLENDS.map((b) => (
              <button key={b.id} onClick={() => sc('textBlendMode', b.id)}
                className={`py-1 rounded text-[7px] font-bold uppercase transition-all ${
                  textBlendMode === b.id ? 'bg-white/20 text-white' : 'bg-white/5 text-white/30 hover:bg-white/10'
                }`}>{b.label}</button>
            ))}
          </div>

          {/* Glow + Color */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="flex justify-between mb-0.5">
                <label className="text-[7px] font-bold uppercase text-white/40">Glow</label>
                <span className="text-[7px] font-mono text-white/30">{textGlow.toFixed(1)}</span>
              </div>
              <input type="range" min="0" max="1" step="0.05" value={textGlow}
                onChange={(e) => sc('textGlow', parseFloat(e.target.value))}
                className="w-full h-0.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#D4A537]" />
            </div>
            <label className="flex items-center gap-1 shrink-0">
              <input type="color" value={textShadowColor} onChange={(e) => sc('textShadowColor', e.target.value)}
                className="w-5 h-5 rounded border border-white/10 bg-transparent cursor-pointer appearance-none" />
            </label>
          </div>

          {/* Stroke */}
          <button onClick={() => sc('textStroke', !textStroke)}
            className={`w-full py-1 rounded text-[7px] font-bold uppercase transition-all ${
              textStroke ? 'bg-[#8B6914]/30 text-[#D4A537] border border-[#8B6914]/50' : 'bg-white/5 text-white/30 hover:bg-white/10 border border-transparent'
            }`}>Outline Only</button>

          {/* Sliders */}
          <div className="space-y-1">
            {[
              { id: 'textFontSize', label: 'Size', min: 6, max: 60, step: 1, val: textFontSize },
              { id: 'textSpeed', label: 'Speed', min: 0.1, max: 5, step: 0.1, val: textSpeed },
              { id: 'textLetterSpacing', label: 'Space', min: -5, max: 20, step: 0.5, val: textLetterSpacing },
              { id: 'textRotation', label: 'Rotate', min: 0, max: 360, step: 5, val: textRotation },
            ].map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <label className="text-[7px] font-bold uppercase text-white/40 w-9 shrink-0">{s.label}</label>
                <input type="range" min={s.min} max={s.max} step={s.step} value={s.val}
                  onChange={(e) => sc(s.id as keyof VisualizerSettings, parseFloat(e.target.value))}
                  className="flex-1 h-0.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#D4A537]" />
                <span className="text-[7px] font-mono text-white/30 w-5 text-right shrink-0">{s.val.toFixed(s.step < 1 ? 1 : 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
});

/** Modulation sliders */
const ModulationSection = React.memo<{ settings: VisualizerSettings; sc: SC }>(({ settings, sc }) => (
  <section className="space-y-2">
    <SectionHeader title="Modulation" />
    <div className="space-y-2">
      {MOD_MACROS.map((macro) => {
        const val = settings[macro.id as keyof VisualizerSettings] as number;
        return (
          <div key={macro.id} className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/60">{macro.label}</label>
              <span className="text-[10px] font-mono text-white/40">{val.toFixed(1)}</span>
            </div>
            <input type="range" min={macro.min} max={macro.max} step={macro.step} value={val}
              onChange={(e) => sc(macro.id as keyof VisualizerSettings, parseFloat(e.target.value))}
              className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-white hover:bg-white/10 transition-colors" />
          </div>
        );
      })}
    </div>
  </section>
), (prev, next) => {
  for (const m of MOD_MACROS) {
    if (prev.settings[m.id as keyof VisualizerSettings] !== next.settings[m.id as keyof VisualizerSettings]) return false;
  }
  return true;
});

/** Background media */
const BackgroundSection = React.memo<{ bgType: string; sc: SC }>(({ bgType, sc }) => {
  const bgInputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="space-y-4">
      <SectionHeader title="Background" />
      <div className="p-2 bg-white/5 rounded-lg border border-white/5 space-y-2">
        <div className="flex gap-2">
          <button onClick={() => sc('backgroundType', 'image')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${bgType === 'image' ? 'bg-white text-black' : 'bg-white/5 text-white/40'}`}>Image</button>
          <button onClick={() => sc('backgroundType', 'video')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${bgType === 'video' ? 'bg-white text-black' : 'bg-white/5 text-white/40'}`}>Video</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => bgInputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 transition-colors">
            <Upload size={12} /> Upload
          </button>
          <button onClick={() => sc('backgroundUrl', '')}
            className="flex items-center justify-center gap-2 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/20 transition-colors">
            <Trash2 size={12} /> Clear
          </button>
        </div>
        <input ref={bgInputRef} type="file" accept={bgType === 'image' ? 'image/*' : 'video/*'}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) sc('backgroundUrl', URL.createObjectURL(f)); }} className="hidden" />
      </div>
    </section>
  );
});

/** Interaction toggles */
const InteractionSection = React.memo<{ mouseOn: boolean; gestureOn: boolean; camOn: boolean; sc: SC }>(
  ({ mouseOn, gestureOn, camOn, sc }) => (
    <section className="space-y-4">
      <SectionHeader title="Interaction" />
      <div className="space-y-2">
        {([
          { id: 'mouseInteraction' as const, label: 'Mouse Influence', icon: MousePointer2, on: mouseOn },
          { id: 'gestureControl' as const, label: 'Hand Gestures', icon: Hand, on: gestureOn },
          { id: 'showCameraPreview' as const, label: 'Camera Feed', icon: Camera, on: camOn },
        ]).map((item) => (
          <button key={item.id} onClick={() => sc(item.id, !item.on)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
              item.on ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'
            }`}>
            <div className="flex items-center gap-3"><item.icon size={14} />
              <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
            </div>
            <div className={`w-2 h-2 rounded-full ${item.on ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'bg-white/10'}`} />
          </button>
        ))}
      </div>
    </section>
  )
);

/** Strobe controls */
const StrobeSection = React.memo<{ strobeType: string; strobeSpeed: number; sc: SC }>(({ strobeType, strobeSpeed, sc }) => (
  <section className="space-y-3">
    <SectionHeader title="Strobe" />
    <div className="flex gap-1">
      {(['bw', 'color', 'geometric', 'invert'] as const).map((st) => (
        <button key={st} onClick={() => sc('strobeType', st)}
          className={`flex-1 py-1.5 rounded text-[8px] font-bold uppercase transition-all ${
            strobeType === st ? 'bg-white/20 text-white' : 'bg-white/5 text-white/30 hover:bg-white/10'
          }`}>{st}</button>
      ))}
    </div>
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Speed</span>
        <span className="text-[10px] font-mono text-white/30">{strobeSpeed.toFixed(1)}</span>
      </div>
      <input type="range" min="0.1" max="5" step="0.1" value={strobeSpeed}
        onChange={(e) => sc('strobeSpeed', parseFloat(e.target.value))}
        className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-white" />
    </div>
  </section>
));

/** Export section */
const ExportSection = React.memo<{
  settings: VisualizerSettings; isRecording: boolean; exportQuality: string;
  onToggleRecording: () => void; onExportQualityChange: (q: '720p' | '1080p' | '4k') => void; sc: SC;
}>(({ settings, isRecording, exportQuality, onToggleRecording, onExportQualityChange, sc }) => (
  <section className="space-y-2">
    <SectionHeader title="Export" />
    {/* Fade In/Out */}
    <div className="flex gap-2">
      <div className="flex-1">
        <div className="flex justify-between mb-0.5">
          <label className="text-[7px] font-bold uppercase text-white/40">Fade In</label>
          <span className="text-[7px] font-mono text-white/30">{settings.fadeInDuration.toFixed(1)}s</span>
        </div>
        <input type="range" min="0" max="5" step="0.5" value={settings.fadeInDuration}
          onChange={(e) => sc('fadeInDuration', parseFloat(e.target.value))}
          className="w-full h-0.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#D4A537]" />
      </div>
      <div className="flex-1">
        <div className="flex justify-between mb-0.5">
          <label className="text-[7px] font-bold uppercase text-white/40">Fade Out</label>
          <span className="text-[7px] font-mono text-white/30">{settings.fadeOutDuration.toFixed(1)}s</span>
        </div>
        <input type="range" min="0" max="5" step="0.5" value={settings.fadeOutDuration}
          onChange={(e) => sc('fadeOutDuration', parseFloat(e.target.value))}
          className="w-full h-0.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#D4A537]" />
      </div>
    </div>
    <div className="flex gap-1">
      {([
        { id: '720p', label: 'Low' },
        { id: '1080p', label: 'Med' },
        { id: '4k', label: 'High' },
      ] as const).map(({ id, label }) => (
        <button key={id} onClick={() => onExportQualityChange(id)}
          title={`${label} bitrate · exports at current canvas size`}
          className={`flex-1 py-1 rounded text-[8px] font-bold uppercase transition-all ${
            exportQuality === id ? 'bg-[#8B6914]/30 text-[#D4A537] border border-[#8B6914]/50' : 'bg-white/5 text-white/30 hover:bg-white/10 border border-transparent'
          }`}>{label}</button>
      ))}
    </div>
    <div className="flex gap-1">
      <button onClick={onToggleRecording}
        className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded border text-[8px] font-bold uppercase transition-colors ${
          isRecording ? 'bg-red-500/20 border-red-500/30 text-red-400 animate-pulse' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
        }`}>{isRecording ? 'Stop' : 'Rec + Play'}</button>
      <button onClick={() => {
        const j = JSON.stringify(settings, null, 2); const b = new Blob([j], { type: 'application/json' }); const u = URL.createObjectURL(b);
        const a = document.createElement('a'); a.href = u; a.download = `prism-settings-${Date.now()}.json`; a.click(); URL.revokeObjectURL(u);
      }} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-white/5 border border-white/10 text-[8px] font-bold uppercase text-white/50 hover:bg-white/10 transition-colors">Settings</button>
    </div>
    <div className="flex gap-1">
      <button onClick={() => {
        const c = { m: settings.mode, cp: settings.colorPrimary, cs: settings.colorSecondary, mi: settings.masterIntensity, bl: settings.bloom, gl: settings.glitch, bs: settings.beatSync, l2: settings.layer2Mode, sp: settings.speed };
        const url = window.location.href.split('#')[0] + '#' + btoa(JSON.stringify(c));
        navigator.clipboard.writeText(url);
      }} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-white/5 border border-white/10 text-[8px] font-bold uppercase text-white/50 hover:bg-white/10 transition-colors">Share Link</button>
      <button onClick={() => {
        const cv = document.querySelector('main canvas') as HTMLCanvasElement;
        if (cv) { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `prism-screenshot-${Date.now()}.png`; a.click(); }
      }} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-white/5 border border-white/10 text-[8px] font-bold uppercase text-white/50 hover:bg-white/10 transition-colors">PNG</button>
    </div>
  </section>
), (prev, next) => prev.isRecording === next.isRecording && prev.exportQuality === next.exportQuality
  && prev.settings.fadeInDuration === next.settings.fadeInDuration && prev.settings.fadeOutDuration === next.settings.fadeOutDuration);

/** Playlist */
const PlaylistSection = React.memo<{
  audioState: AudioState; onSelectTrack: (i: number) => void; onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}>(({ audioState, onSelectTrack, onFileUpload }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="p-6 border-t border-white/5 bg-black/20">
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title="Playlist" />
        <button onClick={() => fileRef.current?.click()} className="p-1.5 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"><Plus size={16} /></button>
        <input ref={fileRef} type="file" multiple accept="audio/*" onChange={onFileUpload} className="hidden" />
      </div>
      <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
        {audioState.playlist.map((track, index) => (
          <button key={index} onClick={() => onSelectTrack(index)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
              audioState.currentIndex === index ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5 hover:text-white/60'
            }`}>
            <Music size={12} className={audioState.currentIndex === index ? 'text-white' : 'text-white/20'} />
            <span className="text-[10px] font-medium truncate">{track.name}</span>
          </button>
        ))}
        {audioState.playlist.length === 0 && (
          <div className="py-4 text-center"><span className="text-[10px] font-mono text-white/20 uppercase tracking-widest italic">No tracks loaded</span></div>
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.audioState.playlist === next.audioState.playlist && prev.audioState.currentIndex === next.audioState.currentIndex);


/** Timeline Markers — record and edit visual cue points along the track */
const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return `${m}:${sec.toString().padStart(2, '0')}.${ms}`;
};

const MARKER_COLORS: Record<string, string> = {
  preset: '#D4A537',
  setting: '#00CCFF',
  action: '#FF4444',
};

const MIDI_LEARN_TARGETS = [
  { id: 'masterIntensity', label: 'Master Int' },
  { id: 'speed', label: 'Speed' },
  { id: 'geoRotationSpeed', label: 'Geo Rot' },
  { id: 'geoScale', label: 'Geo Scale' },
  { id: 'hueRotation', label: 'Hue' },
  { id: 'bloomRadius', label: 'Bloom Rad' },
  { id: 'noise', label: 'Noise' },
  { id: 'chromaticAberration', label: 'CA' },
] as const;

const MidiSection = React.memo<{
  midiEnabled: boolean;
  midiDevices: string[];
  midiMappings: MidiMapping[];
  midiLearningTarget: string | null;
  midiError: string | null;
  onMidiEnableToggle: () => void;
  onMidiLearnStart: (param: string) => void;
  onMidiLearnCancel: () => void;
  onMidiRemoveMapping: (cc: number, channel: number) => void;
}>(({ midiEnabled, midiDevices, midiMappings, midiLearningTarget, midiError, onMidiEnableToggle, onMidiLearnStart, onMidiLearnCancel, onMidiRemoveMapping }) => (
  <section className="space-y-2">
    <div className="flex items-center justify-between">
      <SectionHeader title="MIDI" />
      <button onClick={onMidiEnableToggle}
        className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest transition-all ${
          midiEnabled ? 'bg-[#D4A537]/20 text-[#D4A537] border border-[#8B6914]/50' : 'bg-white/5 text-white/30 border border-white/10 hover:bg-white/10'
        }`}>{midiEnabled ? 'ON' : 'OFF'}</button>
    </div>

    {midiEnabled ? (
      <div className="space-y-2">
        <div className="text-[8px] font-mono text-white/35">
          Devices: {midiDevices.length > 0 ? midiDevices.join(', ') : 'none detected'}
        </div>
        {midiError && (
          <div className="text-[8px] font-mono text-red-400/80 break-words">
            MIDI error: {midiError}
          </div>
        )}

        <div className="grid grid-cols-4 gap-1">
          {MIDI_LEARN_TARGETS.map((t) => (
            <button key={t.id}
              onClick={() => onMidiLearnStart(t.id)}
              className={`px-1 py-1 rounded text-[7px] font-bold uppercase transition-all ${
                midiLearningTarget === t.id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 animate-pulse' : 'bg-white/5 text-white/35 hover:bg-white/10 border border-transparent'
              }`}>{t.label}</button>
          ))}
        </div>

        {midiLearningTarget && (
          <button onClick={onMidiLearnCancel}
            className="w-full py-1 rounded bg-red-500/10 border border-red-500/20 text-[8px] font-bold uppercase text-red-400/80 hover:bg-red-500/20 transition-all">
            Cancel Learn ({midiLearningTarget})
          </button>
        )}

        {midiMappings.length > 0 && (
          <div className="space-y-0.5 max-h-[110px] overflow-y-auto custom-scrollbar border border-white/5 rounded p-1">
            {midiMappings.map((m) => (
              <div key={`${m.cc}-${m.channel}-${m.param}`} className="flex items-center gap-1 group">
                <span className="text-[7px] font-mono text-white/30 w-10 shrink-0">CC{m.cc}</span>
                <span className="text-[7px] font-mono text-white/20 w-6 shrink-0">ch{m.channel + 1}</span>
                <span className="text-[7px] text-white/50 truncate flex-1">{m.param}</span>
                <button onClick={() => onMidiRemoveMapping(m.cc, m.channel)}
                  className="text-[8px] text-red-400/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-1">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    ) : (
      <p className="text-[8px] text-white/20 italic">Enable MIDI to map controller knobs/faders.</p>
    )}
  </section>
));

const TimelineSection = React.memo<{
  markers: TimelineMarker[];
  recording: boolean;
  audioState: AudioState;
  settings: VisualizerSettings;
  onRecordToggle: () => void;
  onAddMarker: (marker: Omit<TimelineMarker, 'id'>) => void;
  onRemoveMarker: (id: string) => void;
  onNudgeMarker: (id: string, delta: number) => void;
  onClear: () => void;
  onApplyPreset: (preset: Partial<VisualizerSettings>) => void;
  sc: SC;
}>(({ markers, recording, audioState, settings, onRecordToggle, onAddMarker, onRemoveMarker, onNudgeMarker, onClear, onApplyPreset, sc }) => {
  const [expanded, setExpanded] = useState(false);
  const [addMode, setAddMode] = useState<'off' | 'preset' | 'setting' | 'action'>('off');
  const [selectedSetting, setSelectedSetting] = useState<string>('mode');

  const currentTime = audioState.currentTime;
  const duration = audioState.duration;

  // Quick-add current settings snapshot as a preset marker at current time
  const addPresetMarkerNow = () => {
    if (duration <= 0) return;
    onAddMarker({
      time: currentTime,
      type: 'preset',
      label: `Snap @${formatTime(currentTime)}`,
      preset: { ...settings },
    });
  };

  // Add a specific setting value as marker
  const addSettingMarkerNow = () => {
    if (duration <= 0 || !selectedSetting) return;
    const val = settings[selectedSetting as keyof VisualizerSettings];
    onAddMarker({
      time: currentTime,
      type: 'setting',
      label: `${selectedSetting}`,
      settingKey: selectedSetting as keyof VisualizerSettings,
      settingValue: val,
    });
    setAddMode('off');
  };

  // Add action marker
  const addActionMarker = (action: 'hit' | 'cut' | 'clear') => {
    if (duration <= 0) return;
    onAddMarker({
      time: currentTime,
      type: 'action',
      label: action.toUpperCase(),
      action,
    });
  };

  // Setting keys for manual marker add
  const SETTING_KEYS = [
    'mode', 'colorPrimary', 'colorSecondary', 'bloom', 'glitch', 'feedback', 'mirror',
    'scanlines', 'vignette', 'kaleidoscope', 'strobeEnabled', 'beatSync', 'masterIntensity',
    'intensity', 'layer2Mode', 'layer2BlendMode', 'textDisplayMode', 'customText',
    'textFont', 'textGlow', 'textBlendMode', 'textFontSize', 'textSpeed', 'textRotation',
    'geoScale', 'geoRotationSpeed', 'geoSymmetry', 'geoTurbulence', 'geoComplexity',
    'hueRotation', 'colorCycleSpeed', 'chromaticAberration', 'noise', 'fluidParticlesEnabled',
    'automationEnabled', 'sweepEnabled', 'lfoEnabled', 'harmonicColorEnabled', 'transitionMorphEnabled',
  ];

  return (
    <section className="space-y-2">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between">
        <SectionHeader title="Timeline" />
        <div className="flex items-center gap-2">
          <span className="text-[8px] font-mono text-white/30">{markers.length} markers</span>
          <span className="text-[8px] text-white/30">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Always visible: Record toggle + progress bar with markers */}
      <div className="space-y-1">
        {/* Mini timeline bar */}
        {duration > 0 && (
          <div className="relative h-6 bg-white/5 rounded overflow-hidden border border-white/10">
            {/* Progress */}
            <div className="absolute inset-y-0 left-0 bg-white/5" style={{ width: `${(currentTime / duration) * 100}%` }} />
            {/* Playhead */}
            <div className="absolute top-0 bottom-0 w-px bg-white/60" style={{ left: `${(currentTime / duration) * 100}%` }} />
            {/* Markers */}
            {markers.map((m) => (
              <div key={m.id}
                className="absolute top-0 bottom-0 w-1 rounded-sm cursor-pointer hover:w-1.5 transition-all group"
                style={{ left: `${(m.time / duration) * 100}%`, backgroundColor: MARKER_COLORS[m.type] || '#fff' }}
                title={`${formatTime(m.time)} — ${m.label}`}
              >
                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-black/90 border border-white/20 rounded text-[7px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  {formatTime(m.time)} {m.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Record + Snapshot buttons */}
        <div className="flex gap-1">
          <button onClick={onRecordToggle}
            className={`flex-1 py-1.5 rounded border text-[8px] font-bold uppercase tracking-wider transition-all ${
              recording
                ? 'bg-red-500/20 border-red-500/40 text-red-400 animate-pulse'
                : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'
            }`}>{recording ? '● REC ON' : '○ REC'}</button>
          <button onClick={addPresetMarkerNow}
            className="flex-1 py-1.5 rounded bg-[#8B6914]/15 border border-[#8B6914]/30 text-[8px] font-bold uppercase tracking-wider text-[#D4A537]/70 hover:bg-[#8B6914]/25 transition-all"
            title="Save current state as marker at playhead position"
          >+ Snap</button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 pt-1 border-t border-white/5">
          {/* Manual add controls */}
          <div className="flex gap-1">
            <button onClick={() => setAddMode(addMode === 'action' ? 'off' : 'action')}
              className={`flex-1 py-1 rounded text-[7px] font-bold uppercase transition-all ${addMode === 'action' ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-white/30 hover:bg-white/10'}`}>+ Action</button>
            <button onClick={() => setAddMode(addMode === 'setting' ? 'off' : 'setting')}
              className={`flex-1 py-1 rounded text-[7px] font-bold uppercase transition-all ${addMode === 'setting' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-white/30 hover:bg-white/10'}`}>+ Setting</button>
          </div>

          {addMode === 'action' && (
            <div className="flex gap-1">
              {(['hit', 'cut', 'clear'] as const).map(a => (
                <button key={a} onClick={() => addActionMarker(a)}
                  className="flex-1 py-1.5 rounded bg-red-500/10 border border-red-500/20 text-[8px] font-bold uppercase text-red-400 hover:bg-red-500/20 transition-all">{a}</button>
              ))}
            </div>
          )}

          {addMode === 'setting' && (
            <div className="space-y-1">
              <select value={selectedSetting} onChange={(e) => setSelectedSetting(e.target.value)}
                className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-[8px] text-white/60 outline-none">
                {SETTING_KEYS.map(k => <option key={k} value={k} className="bg-black">{k}</option>)}
              </select>
              <button onClick={addSettingMarkerNow}
                className="w-full py-1 rounded bg-cyan-500/10 border border-cyan-500/20 text-[8px] font-bold uppercase text-cyan-400 hover:bg-cyan-500/20 transition-all">
                Set "{selectedSetting}" = {String(settings[selectedSetting as keyof VisualizerSettings]).toString().slice(0, 20)} @ {formatTime(currentTime)}
              </button>
            </div>
          )}

          {/* Marker list */}
          {markers.length > 0 && (
            <div className="space-y-0.5 max-h-[200px] overflow-y-auto custom-scrollbar">
              {markers.map((m) => (
                <div key={m.id} className="flex items-center gap-1 group">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: MARKER_COLORS[m.type] }} />
                  <span className="text-[7px] font-mono text-white/40 w-10 shrink-0">{formatTime(m.time)}</span>
                  <span className="text-[7px] text-white/50 truncate flex-1">{m.label}</span>
                  <button onClick={() => onNudgeMarker(m.id, -0.05)}
                    className="text-[7px] text-cyan-300/60 hover:text-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-0.5">-</button>
                  <button onClick={() => onNudgeMarker(m.id, 0.05)}
                    className="text-[7px] text-cyan-300/60 hover:text-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-0.5">+</button>
                  <button onClick={() => onRemoveMarker(m.id)}
                    className="text-[8px] text-red-400/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-1">×</button>
                </div>
              ))}
            </div>
          )}

          {markers.length > 0 && (
            <div className="flex gap-1">
              <button onClick={() => {
                const j = JSON.stringify(markers, null, 2);
                const b = new Blob([j], { type: 'application/json' });
                const u = URL.createObjectURL(b);
                const a = document.createElement('a'); a.href = u; a.download = `prism-timeline-${Date.now()}.json`; a.click(); URL.revokeObjectURL(u);
              }} className="flex-1 py-1 rounded bg-white/5 text-[7px] font-bold uppercase text-white/30 hover:bg-white/10 transition-all">Export</button>
              <button onClick={onClear}
                className="flex-1 py-1 rounded bg-red-500/10 text-[7px] font-bold uppercase text-red-400/60 hover:bg-red-500/20 transition-all">Clear All</button>
            </div>
          )}

          {/* Import timeline */}
          <label className="block">
            <input type="file" accept=".json" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const r = new FileReader();
              r.onload = (ev) => {
                try {
                  const imported: TimelineMarker[] = JSON.parse(ev.target?.result as string);
                  if (Array.isArray(imported)) imported.forEach(m => onAddMarker(m));
                } catch {}
              };
              r.readAsText(f);
              e.target.value = '';
            }} />
            <span className="block w-full py-1 rounded bg-white/5 text-center text-[7px] font-bold uppercase text-white/30 hover:bg-white/10 transition-all cursor-pointer">Import Timeline</span>
          </label>
        </div>
      )}
    </section>
  );
});

// ─── Main Container ─────────────────────────────────────────────────
export const AudioControls: React.FC<AudioControlsProps> = ({
  audioState, settings, onTogglePlay, onVolumeChange, onToggleMute,
  onModeChange, onSettingChange, onFileUpload, onToggleMic, isMicActive,
  onNext, onPrev, onSelectTrack, isRecording, onToggleRecording,
  exportQuality, onExportQualityChange, onApplyPreset, onReset,
  autoPresetEnabled, autoPresetInterval, onAutoPresetToggle, onAutoPresetIntervalChange,
  timelineMarkers, timelineRecording, onTimelineRecordToggle,
  onTimelineAddMarker, onTimelineRemoveMarker, onTimelineNudgeMarker, onTimelineClear,
  midiEnabled, midiDevices, midiMappings, midiLearningTarget,
  midiError, onMidiEnableToggle, onMidiLearnStart, onMidiLearnCancel, onMidiRemoveMapping,
}) => (
  <div className="flex flex-col h-full bg-[#0a0a0a] overflow-hidden">
    <TransportSection audioState={audioState} isMicActive={isMicActive}
      onTogglePlay={onTogglePlay} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute}
      onFileUpload={onFileUpload} onToggleMic={onToggleMic} onNext={onNext} onPrev={onPrev} />

    <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-1 space-y-3">
      {/* Quick Text Mode Toggle */}
      <button
        onClick={() => onSettingChange('mode', settings.mode === 'text' ? 'starfield' : 'text')}
        className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-[9px] font-bold uppercase tracking-widest transition-all ${
          settings.mode === 'text'
            ? 'bg-[#8B6914]/30 text-[#D4A537] border-[#8B6914]/50'
            : 'bg-white/5 text-white/40 hover:bg-white/10 border-white/10'
        }`}
      >
        <span className="text-sm">T</span> Text Mode
      </button>

      <ColorsSection cp={settings.colorPrimary} cs={settings.colorSecondary} sc={onSettingChange} />

      <Layer2Section l2mode={settings.layer2Mode} l2blend={settings.layer2BlendMode}
        l2opacity={settings.layer2Opacity} l2cp={settings.layer2ColorPrimary}
        l2cs={settings.layer2ColorSecondary} sc={onSettingChange} />

      <GeoSection settings={settings} sc={onSettingChange} />

      <PresetsSection onApplyPreset={onApplyPreset} settings={settings} />

      <MidiSection
        midiEnabled={midiEnabled}
        midiDevices={midiDevices}
        midiMappings={midiMappings}
        midiLearningTarget={midiLearningTarget}
        midiError={midiError}
        onMidiEnableToggle={onMidiEnableToggle}
        onMidiLearnStart={onMidiLearnStart}
        onMidiLearnCancel={onMidiLearnCancel}
        onMidiRemoveMapping={onMidiRemoveMapping}
      />

      {/* Auto Preset Cycling */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionHeader title="Auto Presets" />
          <button onClick={onAutoPresetToggle}
            className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest transition-all ${
              autoPresetEnabled ? 'bg-[#D4A537]/20 text-[#D4A537] border border-[#8B6914]/50' : 'bg-white/5 text-white/30 border border-white/10 hover:bg-white/10'
            }`}>{autoPresetEnabled ? 'ON' : 'OFF'}</button>
        </div>
        {autoPresetEnabled && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-white/40">Interval</span>
              <span className="text-[9px] font-mono text-white/50">{autoPresetInterval}s</span>
            </div>
            <input type="range" min={5} max={120} step={5} value={autoPresetInterval}
              onChange={e => onAutoPresetIntervalChange(Number(e.target.value))}
              className="w-full h-1 accent-[#D4A537] bg-white/10 rounded-full appearance-none cursor-pointer" />
            <p className="text-[8px] text-white/20 italic">Random preset every {autoPresetInterval}s during playback</p>
          </div>
        )}
      </section>

      {settings.mode === 'text' && (
        <TextSection textDisplayMode={settings.textDisplayMode} customText={settings.customText}
          textArtist={settings.textArtist} textFont={settings.textFont} textBlendMode={settings.textBlendMode}
          textGlow={settings.textGlow} textStroke={settings.textStroke} textShadowColor={settings.textShadowColor}
          textLetterSpacing={settings.textLetterSpacing} textRotation={settings.textRotation}
          textFontSize={settings.textFontSize} textSpeed={settings.textSpeed} sc={onSettingChange} />
      )}

      <FxSection settings={settings} sc={onSettingChange} />

      <ModulationSection settings={settings} sc={onSettingChange} />

      <BackgroundSection bgType={settings.backgroundType} sc={onSettingChange} />

      <InteractionSection mouseOn={settings.mouseInteraction} gestureOn={settings.gestureControl}
        camOn={settings.showCameraPreview} sc={onSettingChange} />

      {settings.strobeEnabled && (
        <StrobeSection strobeType={settings.strobeType} strobeSpeed={settings.strobeSpeed} sc={onSettingChange} />
      )}

      <TimelineSection markers={timelineMarkers} recording={timelineRecording}
        audioState={audioState} settings={settings}
        onRecordToggle={onTimelineRecordToggle} onAddMarker={onTimelineAddMarker}
        onRemoveMarker={onTimelineRemoveMarker} onNudgeMarker={onTimelineNudgeMarker} onClear={onTimelineClear}
        onApplyPreset={onApplyPreset} sc={onSettingChange} />

      <ExportSection settings={settings} isRecording={isRecording} exportQuality={exportQuality}
        onToggleRecording={onToggleRecording} onExportQualityChange={onExportQualityChange} sc={onSettingChange} />

      <section className="pt-4 space-y-2">
        <button onClick={onReset}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-500/20 transition-colors">
          <RotateCcw size={14} /> Reset All Parameters
        </button>
      </section>
    </div>

    <PlaylistSection audioState={audioState} onSelectTrack={onSelectTrack} onFileUpload={onFileUpload} />
  </div>
);
