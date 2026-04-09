import React, { useState, useRef, useEffect, useCallback, ChangeEvent } from 'react';
import { VisualizerCanvas } from './components/VisualizerCanvas';
import { Visualizer3D } from './components/Visualizer3D';
import { CyberflowVisualizer } from './components/CyberflowVisualizer';
import { HandTracker } from './components/HandTracker';
import { AudioControls, PRESETS } from './components/AudioControls';
import { ShaderVisualizer, SHADER_MODES } from './components/ShaderVisualizer';
import { FluidParticles } from './components/FluidParticles';
import { AudioAnalyzer } from './lib/audioAnalyzer';
import { analyzeTrackKey, getHarmonicColors } from './lib/harmonicColor';
import { analyzeTransition, getTransitionOverrides } from './lib/transitionEngine';
import { captureFrame, startRecording as startReplayRecording, stopRecording as stopReplayRecording, exportSession, isRecordingSession } from './lib/sessionReplay';
import { initMidi, closeMidi, startLearn, cancelLearn, getMappings, removeMapping, getConnectedDevices, getLastMidiError } from './lib/midiLearn';
import { LfoConfig, TimelineMarker } from './types';
import { VisualizerSettings, AudioState, VisualizerMode, PlaylistItem, HandUpdate, HandGesture } from './types';
import { Zap, Maximize2, AlertCircle, RefreshCw, Play, Pause } from 'lucide-react';

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught Error Boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-6">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="text-red-500 w-10 h-10" />
            </div>
            <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
            <p className="text-white/60 text-sm font-mono bg-white/5 p-4 rounded-lg overflow-auto max-h-40">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-full font-medium hover:bg-white/90 transition-colors mx-auto"
            >
              <RefreshCw size={18} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const DEFAULT_SETTINGS: VisualizerSettings = {
  mode: 'text',
  secondaryMode: 'starfield',
  blendMode: 'screen',
  masterIntensity: 0.8,
  sensitivity: 1,
  smoothing: 0.8,
  colorPrimary: '#D4A537',
  colorSecondary: '#1a1a1a',
  barWidth: 0.8,
  showGrid: true,
  intensity: 1.0,
  bloom: true,
  glitch: false,
  feedback: false,
  feedbackTarget: 'primary',
  vignette: false,
  noise: 0.0,
  mirror: false,
  kaleidoscope: false,
  kaleidoscopeSegments: 8,
  scanlines: false,
  chromaticAberration: 0.0,
  distortion: 0.0,
  beatSync: true,
  backgroundUrl: null,
  backgroundType: 'none',
  backgroundBlur: 4,
  backgroundOpacity: 0.3,
  backgroundSaturate: 1.0,
  mouseInteraction: true,
  gestureControl: false,
  showCameraPreview: false,
  textDisplayMode: 'neon_sign',
  textOverlayEnabled: false,
  customText: 'ELASTIC PRISM PRO',
  textArtist: '',
  textFontSize: 28,
  textSpeed: 0.4,
  textCharacters: '@#S%?*+;:,. ',
  textFont: 'display',
  textBlendMode: 'screen',
  textGlow: 0.7,
  textStroke: false,
  textShadowColor: '#D4A537',
  textLetterSpacing: 4,
  textRotation: 0,
  speed: 1.0,
  hueRotation: 0,
  colorCycleSpeed: 0,
  waveAmplitude: 1.0,
  waveFrequency: 1.0,
  particleSize: 1.0,
  particleLife: 1.0,
  glitchIntensity: 0.5,
  bloomThreshold: 0.5,
  bloomRadius: 1.0,
  // Layer 2
  layer2Mode: 'none',
  layer2BlendMode: 'screen',
  layer2Opacity: 0.6,
  // Geometry Macros
  geoScale: 1.0,
  geoRotationSpeed: 0.0,
  geoSymmetry: 1,
  geoSegments: 32,
  geoSpread: 1.0,
  geoDepth: 1.0,
  geoTurbulence: 0.0,
  geoComplexity: 1.0,
  // Fluid Particles
  fluidParticlesEnabled: false,
  fluidParticleCount: 150,
  fluidParticleSize: 1.5,
  // Automation
  automationEnabled: false,
  sweepEnabled: false,
  lfoEnabled: false,
  // Layer 2 Colors
  layer2ColorPrimary: '#00FFCC',
  layer2ColorSecondary: '#FF00FF',
  // Stroboscope
  strobeEnabled: false,
  strobeSpeed: 1,
  strobeType: 'color',
  // Creative Features
  harmonicColorEnabled: false,
  transitionMorphEnabled: false,
  ndiOutputEnabled: false,
  fadeInDuration: 2,
  fadeOutDuration: 2,
};

export default function App() {
  // CORE ARCHITECTURE: Settings live in a ref, NOT in React state.
  // React state syncs ONLY when dirty (user changed something) — never on a blind timer.
  const settingsLiveRef = useRef<VisualizerSettings>({ ...DEFAULT_SETTINGS });
  const [settings, setSettings] = useState<VisualizerSettings>(DEFAULT_SETTINGS);
  const settingsDirtyRef = useRef(false);
  const syncRAFRef = useRef(0);

  // Sync live ref → React state: only when dirty, via rAF (one frame delay, no timer)
  const syncSettingsToUI = useCallback(() => {
    if (syncRAFRef.current) return; // already scheduled
    syncRAFRef.current = requestAnimationFrame(() => {
      syncRAFRef.current = 0;
      if (settingsDirtyRef.current) {
        settingsDirtyRef.current = false;
        setSettings({ ...settingsLiveRef.current });
      }
    });
  }, []);

  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.7,
    isMuted: false,
    fileName: null,
    playlist: [],
    currentIndex: -1,
  });
  const [isMicActive, setIsMicActive] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  // handPos as ref ONLY (no React re-render on hand move)
  const handPosRef = useRef<HandUpdate | null>(null);
  const setHandPos = useCallback((hp: HandUpdate | null) => { handPosRef.current = hp; }, []);
  const handPos = handPosRef.current; // read once per render
  const [shareNotification, setShareNotification] = useState(false);
  const [detectedKey, setDetectedKey] = useState('');
  const [transitionPhase, setTransitionPhase] = useState('');
  const detectedKeyRef = useRef('');
  const transitionPhaseRef = useRef('');
  const ndiStreamRef = useRef<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [midiMappings, setMidiMappings] = useState(getMappings());
  const [midiLearningTarget, setMidiLearningTarget] = useState<string | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [showLivePanel, setShowLivePanel] = useState(false);
  const [liveXY, setLiveXY] = useState({ x: 0.5, y: 0.5 });
  const [liveXYDrag, setLiveXYDrag] = useState(false);
  const [livePresetBank, setLivePresetBank] = useState<'A' | 'B'>('A');
  const [liveVisualBank, setLiveVisualBank] = useState<'C' | 'D'>('C');
  const [liveXYMode, setLiveXYMode] = useState<'color' | 'motion' | 'space'>('color');
  const [livePanelLocked, setLivePanelLocked] = useState(false);
  const [liveInputMode, setLiveInputMode] = useState<'free' | 'tight' | 'ultra'>('tight');
  const [liveTextDraft, setLiveTextDraft] = useState(DEFAULT_SETTINGS.customText);
  const [liveAutoZoomEnabled, setLiveAutoZoomEnabled] = useState(false);
  const [liveAutoZoomSpeed, setLiveAutoZoomSpeed] = useState(0.8);
  const [visualTransitionType, setVisualTransitionType] = useState<'fade' | 'cut' | 'melt'>('fade');
  const [visualTransitionMs, setVisualTransitionMs] = useState(420);
  const [isVisualTransitioning, setIsVisualTransitioning] = useState(false);
  const [visualTransitionPrevMode, setVisualTransitionPrevMode] = useState<VisualizerMode | null>(null);
  const [visualTransitionProgress, setVisualTransitionProgress] = useState(1);
  const liveXYPadRef = useRef<HTMLDivElement>(null);
  const keyLastFireRef = useRef<Record<string, number>>({});
  const liveXYLastMarkerMsRef = useRef(0);
  const liveXYLastRecordedRef = useRef<{ a: number; b: number } | null>(null);
  const autoZoomValueRef = useRef(DEFAULT_SETTINGS.geoScale);
  const autoZoomDirectionRef = useRef<1 | -1>(1);
  const liveAutoZoomEnabledRef = useRef(false);
  liveAutoZoomEnabledRef.current = liveAutoZoomEnabled;
  const liveAutoZoomSpeedRef = useRef(0.8);
  liveAutoZoomSpeedRef.current = liveAutoZoomSpeed;
  const visualTransitionStartRef = useRef(0);
  // mousePos as ref ONLY (no React re-render on mouse move)
  const mousePosStateRef = useRef({ x: 0.5, y: 0.5 });
  const mousePos = mousePosStateRef.current;
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const presetCooldownRef = useRef(0);

  // handleSettingChange and handleApplyPreset are defined after timeline state (below)
  // Forward declarations via refs to avoid circular dependency
  const handleSettingChangeRef = useRef<(key: keyof VisualizerSettings, value: VisualizerSettings[keyof VisualizerSettings]) => void>(() => {});
  const handleApplyPresetRef = useRef<(preset: Partial<VisualizerSettings>) => void>(() => {});
  const handleSettingChange = useCallback((key: keyof VisualizerSettings, value: VisualizerSettings[keyof VisualizerSettings]) => {
    handleSettingChangeRef.current(key, value);
  }, []);
  const handleApplyPreset = useCallback((preset: Partial<VisualizerSettings>) => {
    handleApplyPresetRef.current(preset);
  }, []);

  // Export quality setting
  const [exportQuality, setExportQuality] = useState<'720p' | '1080p' | '4k'>('1080p');
  // Realistic bitrates that browsers can handle without freezing
  const exportBitrates: Record<string, number> = { '720p': 4_000_000, '1080p': 8_000_000, '4k': 16_000_000 };
  const exportFps: Record<string, number> = { '720p': 30, '1080p': 30, '4k': 30 };
  const isRecordingRef = useRef(false);

  const startRecording = useCallback(() => {
    if (typeof MediaRecorder === 'undefined') return;
    const canvas = document.querySelector('main canvas') as HTMLCanvasElement;
    if (!canvas) return;

    // Start song from beginning
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }

    const fps = exportFps[exportQuality] || 30;
    const canvasStream = canvas.captureStream(fps);
    const audioStream = analyzerRef.current?.getAudioStream();

    const tracks = [...canvasStream.getTracks()];
    if (audioStream) tracks.push(...audioStream.getTracks());
    const combinedStream = new MediaStream(tracks);

    // VP8 is faster to encode than VP9 (less CPU, less freeze)
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

    const bitrate = exportBitrates[exportQuality] || 8_000_000;
    const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: bitrate });

    recordedChunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prism-${exportQuality}-${Date.now()}.webm`;
      // Delay revoke so download can complete
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      isRecordingRef.current = false;
      recordedChunksRef.current = []; // Free memory
    };

    // Smaller chunks = less memory pressure per chunk
    recorder.start(500);
    mediaRecorderRef.current = recorder;
    isRecordingRef.current = true;
    setIsRecording(true);
  }, [exportQuality]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Write to ref directly (no React re-render)
      mousePosStateRef.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    };
    const handleTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) mousePosStateRef.current = { x: t.clientX / window.innerWidth, y: t.clientY / window.innerHeight };
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [settings.mouseInteraction]);

  // Initialize Analyzer
  useEffect(() => {
    analyzerRef.current = new AudioAnalyzer();
    return () => analyzerRef.current?.close();
  }, []);

  // Update smoothing when settings change
  useEffect(() => {
    analyzerRef.current?.setSmoothing(settings.smoothing);
  }, [settings.smoothing]);

  const handleTogglePlay = useCallback(async () => {
    if (!audioRef.current) return;
    
    // Always try to resume context on user interaction
    if (analyzerRef.current) {
      await analyzerRef.current.connectElement(audioRef.current);
    }

    if (audioState.isPlaying) {
      // If we are playing, we want to pause.
      // But we must wait for any pending play promise to resolve first.
      if (playPromiseRef.current) {
        try {
          await playPromiseRef.current;
        } catch (e) {
          // Ignore play errors when trying to pause
        }
      }
      audioRef.current.pause();
    } else {
      try {
        playPromiseRef.current = audioRef.current.play();
        await playPromiseRef.current;
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error("Playback failed:", err);
        }
      } finally {
        playPromiseRef.current = null;
      }
    }
  }, [audioState.isPlaying]);

  const handleVolumeChange = useCallback((value: number) => {
    if (audioRef.current) {
      audioRef.current.volume = value;
    }
    setAudioState(prev => ({ ...prev, volume: value }));
  }, []);

  const handleToggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !audioRef.current.muted;
    }
    setAudioState(prev => ({ ...prev, isMuted: !prev.isMuted }));
  }, []);

  const playTrack = useCallback(async (index: number) => {
    const track = audioState.playlist[index];
    if (track && audioRef.current) {
      // If there's a pending play, wait for it before changing src
      if (playPromiseRef.current) {
        try {
          await playPromiseRef.current;
        } catch (e) {
          // Ignore
        }
      }

      audioRef.current.src = track.url;
      setAudioState(prev => ({
        ...prev,
        fileName: track.name,
        currentIndex: index,
        isPlaying: false,
        currentTime: 0
      }));
      setIsMicActive(false);

      // Analyze key offline when track loads (non-blocking)
      if (settings.harmonicColorEnabled) {
        analyzeTrackKey(track.url).then(result => {
          if (result.confidence > 0.3) {
            setDetectedKey(result.key);
          }
        });
      }
      
      // Auto-play
      try {
        if (analyzerRef.current) {
          await analyzerRef.current.connectElement(audioRef.current);
        }
        playPromiseRef.current = audioRef.current.play();
        await playPromiseRef.current;
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error("Auto-play failed:", err);
        }
      } finally {
        playPromiseRef.current = null;
      }
    }
  }, [audioState.playlist]);

  const handleFileUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newItems: PlaylistItem[] = Array.from(files).map((file: File) => ({
        id: Math.random().toString(36).substr(2, 9),
        file,
        name: file.name,
        url: URL.createObjectURL(file),
      }));

      setAudioState(prev => ({
        ...prev,
        playlist: [...prev.playlist, ...newItems],
      }));
    }
  }, []);

  // Auto-play first track when playlist goes from empty to non-empty
  useEffect(() => {
    if (audioState.playlist.length > 0 && audioState.currentIndex === -1) {
      playTrack(0);
    }
  }, [audioState.playlist, audioState.currentIndex, playTrack]);

  const handleNextTrack = useCallback(() => {
    if (audioState.playlist.length === 0) return;
    const nextIndex = (audioState.currentIndex + 1) % audioState.playlist.length;
    playTrack(nextIndex);
  }, [audioState.playlist, audioState.currentIndex, playTrack]);

  const handlePrevTrack = useCallback(() => {
    if (audioState.playlist.length === 0) return;
    const prevIndex = (audioState.currentIndex - 1 + audioState.playlist.length) % audioState.playlist.length;
    playTrack(prevIndex);
  }, [audioState.playlist, audioState.currentIndex, playTrack]);

  const handleToggleMic = useCallback(async () => {
    if (isMicActive) {
      setIsMicActive(false);
      // Reconnect audio element if it was playing
      if (audioRef.current && audioState.isPlaying) {
        analyzerRef.current?.connectElement(audioRef.current);
      }
    } else {
      try {
        await analyzerRef.current?.connectMicrophone();
        setIsMicActive(true);
        if (audioRef.current) {
          if (playPromiseRef.current) {
            try {
              await playPromiseRef.current;
            } catch (e) {
              // Ignore
            }
          }
          audioRef.current.pause();
        }
        setAudioState(prev => ({ ...prev, isPlaying: false }));
      } catch (err) {
        console.error("Could not access microphone. Please check permissions.", err);
      }
    }
  }, [isMicActive]);

  // PERFORMANCE: Time updates go to ref (no re-render). State updated at 1Hz for display only.
  const lastDisplayUpdateRef = useRef(0);
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    // Always update ref (engines read this)
    audioStateRef.current = {
      ...audioStateRef.current,
      currentTime: audioRef.current.currentTime || 0,
      duration: audioRef.current.duration || 0,
    };
    // Throttle state update to 1Hz (only for time display in UI)
    const now = Date.now();
    if (now - lastDisplayUpdateRef.current > 1000) {
      lastDisplayUpdateRef.current = now;
      setAudioState(prev => ({
        ...prev,
        currentTime: audioRef.current?.currentTime || 0,
        duration: audioRef.current?.duration || 0,
      }));
    }
  };

  // Harmonic Color Engine + Transition Morph Engine
  // CRITICAL: These run via ref-only updates, NO setSettings (avoids render cascade)
  useEffect(() => {
    const interval = setInterval(() => {
      const s = settingsForEngineRef.current;

      // Harmonic Color: update display (only if changed)
      if (s.harmonicColorEnabled) {
        const harmony = getHarmonicColors();
        if (harmony && harmony.confidence > 0.3 && harmony.key !== detectedKeyRef.current) {
          detectedKeyRef.current = harmony.key;
          setDetectedKey(harmony.key);
        }
      }

      // Transition Morph: update display (only if changed)
      if (s.transitionMorphEnabled) {
        const freqData = analyzerRef.current?.getFrequencyData();
        if (freqData && freqData.length > 0) {
          const state = analyzeTransition(freqData);
          if (state.phase !== transitionPhaseRef.current) {
            transitionPhaseRef.current = state.phase;
            setTransitionPhase(state.phase);
          }
        }
      }

      captureFrame(s);
    }, 1000); // 1Hz - minimal React re-renders

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NDI Virtual Output - capture canvas stream
  useEffect(() => {
    if (!settings.ndiOutputEnabled) {
      if (ndiStreamRef.current) {
        ndiStreamRef.current.getTracks().forEach(t => t.stop());
        ndiStreamRef.current = null;
      }
      return;
    }
    const canvas = document.querySelector('main canvas') as HTMLCanvasElement;
    if (canvas) {
      ndiStreamRef.current = canvas.captureStream(60);
    }
    return () => {
      if (ndiStreamRef.current) {
        ndiStreamRef.current.getTracks().forEach(t => t.stop());
        ndiStreamRef.current = null;
      }
    };
  }, [settings.ndiOutputEnabled]);

  // Visual Automation - multi-lane parameter automation over song length
  const automationLanesRef = useRef<import('./types').AutomationLane[]>([
    { param: 'geoScale', curve: 'sine', min: 0.6, max: 1.8, speed: 2, enabled: true },
    { param: 'geoRotationSpeed', curve: 'ramp', min: 0, max: 3, speed: 1, enabled: true },
    { param: 'hueRotation', curve: 'sawtooth', min: 0, max: 360, speed: 1, enabled: true },
    { param: 'geoTurbulence', curve: 'sine', min: 0, max: 1.2, speed: 4, enabled: true },
    { param: 'geoComplexity', curve: 'sine', min: 0.5, max: 2.5, speed: 1.5, enabled: true },
    { param: 'geoSymmetry', curve: 'pulse', min: 1, max: 8, speed: 2, enabled: true },
    { param: 'bloomRadius', curve: 'sine', min: 0.3, max: 2, speed: 3, enabled: true },
    { param: 'intensity', curve: 'sine', min: 0.7, max: 1.5, speed: 2, enabled: true },
    // Text parameter automation
    { param: 'textGlow', curve: 'sine', min: 0.1, max: 1.0, speed: 3, enabled: true },
    { param: 'textFontSize', curve: 'sine', min: 10, max: 48, speed: 1.5, enabled: true },
    { param: 'textSpeed', curve: 'ramp', min: 0.3, max: 3.0, speed: 1, enabled: true },
    { param: 'textLetterSpacing', curve: 'sine', min: -2, max: 12, speed: 2, enabled: true },
    { param: 'textRotation', curve: 'sawtooth', min: 0, max: 360, speed: 0.5, enabled: true },
  ]);

  // Engine overrides ref - all engines write here, visualizers read it per-frame
  const engineOverridesRef = useRef<Partial<VisualizerSettings>>({});

  // All engine settings read via refs (never stale, no effect re-creation)
  const settingsForEngineRef = useRef(settings);
  // Engine always reads from the live ref (not from React state)
  settingsForEngineRef.current = settingsLiveRef.current;
  const audioStateRef = useRef(audioState);
  audioStateRef.current = audioState;

  useEffect(() => {
    // Single 30fps engine loop - reads ALL state via refs (zero React dependency)
    const engineLoop = setInterval(() => {
      // Skip during preset cooldown (prevents engines from fighting with preset)
      if (Date.now() < presetCooldownRef.current) return;

      const s = settingsForEngineRef.current;
      const audio = audioStateRef.current;
      const overrides: Record<string, unknown> = {};

      // Harmonic Color Engine (uses cached offline analysis)
      if (s.harmonicColorEnabled) {
        const harmony = getHarmonicColors();
        if (harmony && harmony.confidence > 0.3) {
          overrides.colorPrimary = harmony.suggestedPrimary;
          overrides.colorSecondary = harmony.suggestedSecondary;
        }
      }

      // Transition Morph Engine
      if (s.transitionMorphEnabled) {
        const freqData = analyzerRef.current?.getFrequencyData();
        if (freqData && freqData.length > 0) {
          const state = analyzeTransition(freqData);
          Object.assign(overrides, getTransitionOverrides(state));
        }
      }

      // Visual Automation over song length
      if (s.automationEnabled && audio.duration > 0 && audio.currentTime >= 0) {
        const t = audio.currentTime / audio.duration;
        if (isFinite(t) && !isNaN(t)) {
          const tau = Math.PI * 2;
          for (const lane of automationLanesRef.current) {
            if (!lane.enabled) continue;
            const phase = t * lane.speed;
            let value: number;
            switch (lane.curve) {
              case 'sine': value = (Math.sin(phase * tau) + 1) * 0.5; break;
              case 'ramp': value = phase % 1; break;
              case 'sawtooth': value = (phase * 2) % 1; break;
              case 'pulse': value = Math.sin(phase * tau) > 0 ? 1 : 0; break;
              case 'random': value = Math.abs((Math.sin(phase * 127.1) * 43758.5453) % 1); break;
              default: value = 0.5;
            }
            const result = lane.min + value * (lane.max - lane.min);
            if (isFinite(result)) overrides[lane.param] = result;
          }
        }
      }

      // LFO System (4 slots)
      if (s.lfoEnabled) {
        const now = performance.now() * 0.001;
        for (const lfo of lfosRef.current) {
          if (!lfo.enabled || !lfo.target) continue;
          const phase = now * lfo.rate;
          let val: number;
          switch (lfo.shape) {
            case 'sine': val = (Math.sin(phase * Math.PI * 2) + 1) * 0.5; break;
            case 'triangle': val = Math.abs((phase % 1) * 2 - 1); break;
            case 'square': val = (phase % 1) < 0.5 ? 1 : 0; break;
            case 'saw': val = phase % 1; break;
            default: val = 0.5;
          }
          overrides[lfo.target] = val * lfo.depth;
        }
      }

      // Manual HIT decay
      if (manualHitRef.current > 0.01) {
        overrides.masterIntensity = (s.masterIntensity || 1) + manualHitRef.current;
        overrides.bloomRadius = (s.bloomRadius || 1) + manualHitRef.current * 2;
        manualHitRef.current *= 0.82;
      }

      // CUT effect countdown
      if (cutFramesRef.current > 0) {
        overrides.noise = 1; // Full noise = visual cut
        cutFramesRef.current--;
      }

      // SWEEP position advance
      if (s.sweepEnabled) {
        sweepPosRef.current = (sweepPosRef.current + 0.005 * s.speed) % 1;
      }

      // ─── Live Auto Zoom (pause/resume without jumps) ────────────────
      if (liveAutoZoomEnabledRef.current) {
        const minZ = 0.4;
        const maxZ = 2.8;
        const step = liveAutoZoomSpeedRef.current * 0.02;
        let z = autoZoomValueRef.current + autoZoomDirectionRef.current * step;
        if (z >= maxZ) {
          z = maxZ;
          autoZoomDirectionRef.current = -1;
        } else if (z <= minZ) {
          z = minZ;
          autoZoomDirectionRef.current = 1;
        }
        autoZoomValueRef.current = z;
        overrides.geoScale = z;
      } else if (typeof autoZoomValueRef.current === 'number') {
        // Hold exact paused position in visuals.
        overrides.geoScale = autoZoomValueRef.current;
      }

      // ─── Fade In/Out Overlay ────────────────────────────────────────
      if (fadeOverlayRef.current && audio.duration > 0) {
        const fadeIn = s.fadeInDuration || 0;
        const fadeOut = s.fadeOutDuration || 0;
        let fadeOpacity = 0;
        if (fadeIn > 0 && audio.currentTime < fadeIn) {
          fadeOpacity = 1 - (audio.currentTime / fadeIn); // 1→0
        }
        if (fadeOut > 0 && audio.currentTime > audio.duration - fadeOut) {
          fadeOpacity = Math.max(fadeOpacity, (audio.currentTime - (audio.duration - fadeOut)) / fadeOut); // 0→1
        }
        fadeOverlayRef.current.style.opacity = String(Math.min(1, Math.max(0, fadeOpacity)));
      } else if (fadeOverlayRef.current) {
        fadeOverlayRef.current.style.opacity = '0';
      }

      // ─── Timeline Marker Playback ───────────────────────────────────
      if (!timelineRecordingRef.current && timelineMarkersRef.current.length > 0 && audio.isPlaying) {
        const ct = audio.currentTime;
        // Detect seek: if time jumped backward, reset fired tracking
        if (ct < lastFiredTimeRef.current - 0.5) {
          lastFiredMarkerRef.current = null;
        }
        lastFiredTimeRef.current = ct;

        for (const marker of timelineMarkersRef.current) {
          // Fire markers within a 100ms window ahead of current time (avoids missing on frame skip)
          if (marker.time >= ct - 0.05 && marker.time <= ct + 0.1) {
            if (lastFiredMarkerRef.current === marker.id) continue; // already fired
            lastFiredMarkerRef.current = marker.id;

            if (marker.type === 'preset' && marker.preset) {
              // Apply preset via ref (no cooldown during timeline playback)
              Object.assign(settingsLiveRef.current, marker.preset);
              settingsDirtyRef.current = true;
              // Schedule sync outside the interval
              requestAnimationFrame(() => {
                if (settingsDirtyRef.current) {
                  settingsDirtyRef.current = false;
                  setSettings({ ...settingsLiveRef.current });
                }
              });
            } else if (marker.type === 'setting' && marker.settingKey) {
              (settingsLiveRef.current as unknown as Record<string, unknown>)[marker.settingKey] = marker.settingValue;
              settingsDirtyRef.current = true;
              requestAnimationFrame(() => {
                if (settingsDirtyRef.current) {
                  settingsDirtyRef.current = false;
                  setSettings({ ...settingsLiveRef.current });
                }
              });
            } else if (marker.type === 'action') {
              if (marker.action === 'hit') manualHitRef.current = 1.0;
              else if (marker.action === 'cut') cutFramesRef.current = 4;
              else if (marker.action === 'clear') {
                Object.keys(overrides).forEach(k => delete overrides[k]);
                manualHitRef.current = 0;
                cutFramesRef.current = 0;
                sweepPosRef.current = 0;
              }
            }
          }
        }
      }

      // ─── Auto Preset Cycling ────────────────────────────────────────
      if (autoPresetEnabledRef.current && audio.isPlaying && PRESETS.length > 0) {
        const now = Date.now() / 1000;
        const interval = autoPresetIntervalRef.current;
        if (now - lastAutoPresetTimeRef.current >= interval) {
          lastAutoPresetTimeRef.current = now;
          // Pick a random preset different from the last one
          let idx: number;
          do {
            idx = Math.floor(Math.random() * PRESETS.length);
          } while (idx === lastAutoPresetIndexRef.current && PRESETS.length > 1);
          lastAutoPresetIndexRef.current = idx;
          const preset = PRESETS[idx].settings;
          // Apply preset via ref (same as timeline playback — no cooldown conflict)
          presetCooldownRef.current = Date.now() + 300;
          Object.assign(settingsLiveRef.current, preset);
          settingsDirtyRef.current = true;
          requestAnimationFrame(() => {
            if (settingsDirtyRef.current) {
              settingsDirtyRef.current = false;
              setSettings({ ...settingsLiveRef.current });
            }
          });
        }
      }

      engineOverridesRef.current = overrides as Partial<VisualizerSettings>;
    }, 33);

    return () => clearInterval(engineLoop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount once - reads everything via refs

  // Gesture control handlers
  const lastGestureRef = useRef<HandGesture>('none');
  useEffect(() => {
    if (!handPos || !settings.gestureControl) return;
    const gesture = handPos.gesture;
    const prevGesture = lastGestureRef.current;

    // Only trigger on gesture change (not every frame)
    if (gesture !== prevGesture) {
      if (gesture === 'pinch') {
        // Pinch controls master intensity
      } else if (gesture === 'fist' && prevGesture !== 'fist') {
        setIsZenMode(prev => !prev);
      } else if (gesture === 'open_palm' && prevGesture !== 'open_palm') {
        handleTogglePlay();
      } else if (gesture === 'wave' && prevGesture !== 'wave') {
        handleNextTrack();
      }
      lastGestureRef.current = gesture;
    }

    // Continuous: pinch distance controls intensity (via engine ref, no state update)
    if (gesture === 'pinch') {
      engineOverridesRef.current = {
        ...engineOverridesRef.current,
        masterIntensity: Math.max(0.1, Math.min(3, 0.5 + handPos.pinchDistance * 1.5)),
      };
    }
  }, [handPos, settings.gestureControl]);

  // Load settings from URL hash on startup
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      try {
        const compact = JSON.parse(atob(hash));
        const restored: Partial<VisualizerSettings> = {};
        if (compact.m) restored.mode = compact.m;
        if (compact.sm) restored.secondaryMode = compact.sm;
        if (compact.bm) restored.blendMode = compact.bm;
        if (compact.cp) restored.colorPrimary = compact.cp;
        if (compact.cs) restored.colorSecondary = compact.cs;
        if (compact.mi !== undefined) restored.masterIntensity = compact.mi;
        if (compact.s !== undefined) restored.sensitivity = compact.s;
        if (compact.i !== undefined) restored.intensity = compact.i;
        if (compact.bl !== undefined) restored.bloom = compact.bl;
        if (compact.gl !== undefined) restored.glitch = compact.gl;
        if (compact.fb !== undefined) restored.feedback = compact.fb;
        if (compact.vg !== undefined) restored.vignette = compact.vg;
        if (compact.bs !== undefined) restored.beatSync = compact.bs;
        if (compact.sp !== undefined) restored.speed = compact.sp;
        handleApplyPreset(restored);
      } catch {
        // Invalid hash, ignore
      }
    }
  }, []);

  // Fade overlay ref (DOM-driven, no re-render)
  const fadeOverlayRef = useRef<HTMLDivElement>(null);

  // Pro feature refs (no state, no re-render)
  const manualHitRef = useRef(0);  // 0-1, decays to 0
  const cutFramesRef = useRef(0);  // countdown frames for cut effect
  const sweepPosRef = useRef(0);   // 0-1 sweep position
  const midiEnabledRef = useRef(false);
  midiEnabledRef.current = midiEnabled;

  // ─── Timeline Marker System ────────────────────────────────────────
  const [timelineMarkers, setTimelineMarkers] = useState<TimelineMarker[]>(() => {
    try { const s = localStorage.getItem('prism_timeline'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [timelineRecording, setTimelineRecording] = useState(false);
  const timelineMarkersRef = useRef<TimelineMarker[]>([]);
  timelineMarkersRef.current = timelineMarkers;
  const timelineRecordingRef = useRef(false);
  timelineRecordingRef.current = timelineRecording;
  const lastFiredMarkerRef = useRef<string | null>(null);
  const lastFiredTimeRef = useRef(-1);

  // Persist markers
  useEffect(() => {
    const t = window.setTimeout(() => {
      localStorage.setItem('prism_timeline', JSON.stringify(timelineMarkers));
    }, 400);
    return () => window.clearTimeout(t);
  }, [timelineMarkers]);

  // Record a marker: captures current action at current playback time
  const addTimelineMarker = useCallback((marker: Omit<TimelineMarker, 'id'>) => {
    const m: TimelineMarker = { ...marker, id: Math.random().toString(36).substr(2, 9) };
    setTimelineMarkers(prev => [...prev, m].sort((a, b) => a.time - b.time).slice(-2000));
  }, []);

  const removeTimelineMarker = useCallback((id: string) => {
    setTimelineMarkers(prev => prev.filter(m => m.id !== id));
  }, []);

  const nudgeTimelineMarker = useCallback((id: string, delta: number) => {
    setTimelineMarkers(prev => {
      const duration = audioStateRef.current.duration || 0;
      return prev
        .map(m => m.id === id ? { ...m, time: Math.max(0, duration > 0 ? Math.min(duration, m.time + delta) : m.time + delta) } : m)
        .sort((a, b) => a.time - b.time);
    });
  }, []);

  const clearTimelineMarkers = useCallback(() => {
    setTimelineMarkers([]);
    lastFiredMarkerRef.current = null;
    lastFiredTimeRef.current = -1;
  }, []);

  const recordLiveActionMarker = useCallback((action: 'hit' | 'cut' | 'clear', label?: string) => {
    if (timelineRecordingRef.current && audioStateRef.current.duration > 0) {
      addTimelineMarker({
        time: audioStateRef.current.currentTime,
        type: 'action',
        label: label || action.toUpperCase(),
        action,
      });
    }
  }, [addTimelineMarker]);

  const startVisualTransition = useCallback((nextMode: VisualizerMode) => {
    const currentMode = settingsLiveRef.current.mode;
    if (currentMode === nextMode) return;
    setVisualTransitionPrevMode(currentMode);
    setVisualTransitionProgress(0);
    setIsVisualTransitioning(true);
    visualTransitionStartRef.current = performance.now();
  }, []);

  // Intercept setting changes when timeline recording is active
  const handleSettingChangeWithTimeline = useCallback((key: keyof VisualizerSettings, value: VisualizerSettings[keyof VisualizerSettings]) => {
    if (key === 'mode') {
      startVisualTransition(value as VisualizerMode);
    }
    // Always apply the change
    (settingsLiveRef.current as unknown as Record<string, unknown>)[key] = value;
    settingsDirtyRef.current = true;
    syncSettingsToUI();

    // If recording, save as marker
    if (timelineRecordingRef.current && audioStateRef.current.duration > 0) {
      const time = audioStateRef.current.currentTime;
      if (key === 'mode') {
        addTimelineMarker({ time, type: 'setting', label: `→ ${value}`, settingKey: key, settingValue: value });
      } else {
        addTimelineMarker({ time, type: 'setting', label: `${key}`, settingKey: key, settingValue: value });
      }
    }
  }, [syncSettingsToUI, addTimelineMarker, startVisualTransition]);

  const handleApplyPresetWithTimeline = useCallback((preset: Partial<VisualizerSettings>) => {
    if (preset.mode) {
      startVisualTransition(preset.mode);
    }
    presetCooldownRef.current = Date.now() + 300;
    engineOverridesRef.current = {};
    Object.assign(settingsLiveRef.current, preset);
    settingsDirtyRef.current = true;
    syncSettingsToUI();

    // If recording, save as marker
    if (timelineRecordingRef.current && audioStateRef.current.duration > 0) {
      const time = audioStateRef.current.currentTime;
      const label = preset.mode ? `Preset ${preset.mode}` : 'Preset';
      addTimelineMarker({ time, type: 'preset', label, preset });
    }
  }, [syncSettingsToUI, addTimelineMarker]);

  // Wire forward refs so handleSettingChange/handleApplyPreset use timeline-aware versions
  handleSettingChangeRef.current = handleSettingChangeWithTimeline;
  handleApplyPresetRef.current = handleApplyPresetWithTimeline;

  // ─── Auto Preset Cycling ──────────────────────────────────────────
  const [autoPresetEnabled, setAutoPresetEnabled] = useState(false);
  const [autoPresetInterval, setAutoPresetInterval] = useState(30); // seconds
  const autoPresetEnabledRef = useRef(false);
  autoPresetEnabledRef.current = autoPresetEnabled;
  const autoPresetIntervalRef = useRef(30);
  autoPresetIntervalRef.current = autoPresetInterval;
  const lastAutoPresetTimeRef = useRef(0);
  const lastAutoPresetIndexRef = useRef(-1);

  // LFO system (4 slots, runs in engine loop)
  const lfosRef = useRef<LfoConfig[]>([
    { shape: 'sine', rate: 1, depth: 0.5, target: 'geoScale', enabled: false },
    { shape: 'triangle', rate: 0.5, depth: 0.3, target: 'hueRotation', enabled: false },
    { shape: 'sine', rate: 2, depth: 0.4, target: 'geoTurbulence', enabled: false },
    { shape: 'saw', rate: 0.25, depth: 1.0, target: 'geoRotationSpeed', enabled: false },
  ]);

  // MIDI initialization
  useEffect(() => {
    if (!midiEnabled) {
      closeMidi();
      setMidiDevices([]);
      setMidiLearningTarget(null);
      return;
    }

    let mounted = true;
    initMidi((param, value) => {
      // Write MIDI values directly to engine overrides (zero re-renders)
      engineOverridesRef.current = { ...engineOverridesRef.current, [param]: value };
    }, (devices) => {
      if (!mounted) return;
      setMidiDevices(devices);
    }).then((devices) => {
      if (!mounted) return;
      setMidiDevices(devices);
      setMidiMappings(getMappings());
      setMidiError(getLastMidiError());
    });

    // Keep UI in sync when devices connect/disconnect after MIDI is enabled.
    const refreshTimer = window.setInterval(() => {
      if (!mounted) return;
      setMidiDevices(getConnectedDevices());
      setMidiError(getLastMidiError());
    }, 1000);

    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
      closeMidi();
    };
  }, [midiEnabled]);

  const handleMidiEnableToggle = useCallback(() => {
    setMidiEnabled(prev => !prev);
  }, []);

  const handleMidiLearnStart = useCallback((param: string) => {
    if (!midiEnabledRef.current) return;
    setMidiLearningTarget(param);
    startLearn(param, () => {
      setMidiLearningTarget(null);
      setMidiMappings(getMappings());
    });
  }, []);

  const handleMidiLearnCancel = useCallback(() => {
    cancelLearn();
    setMidiLearningTarget(null);
  }, []);

  const handleMidiRemoveMapping = useCallback((cc: number, channel: number) => {
    removeMapping(cc, channel);
    setMidiMappings(getMappings());
  }, []);

  const applyLiveXY = useCallback((x: number, y: number) => {
    const nx = Math.max(0, Math.min(1, x));
    const ny = Math.max(0, Math.min(1, y));
    setLiveXY({ x: nx, y: ny });
    if (liveXYMode === 'color') {
      settingsLiveRef.current.hueRotation = nx * 360;
      settingsLiveRef.current.masterIntensity = 0.4 + (1 - ny) * 2.1;
    } else if (liveXYMode === 'motion') {
      settingsLiveRef.current.speed = 0.2 + nx * 2.8;
      settingsLiveRef.current.geoRotationSpeed = ny * 5;
    } else {
      settingsLiveRef.current.geoScale = 0.4 + nx * 2.6;
      settingsLiveRef.current.geoDepth = 0.3 + (1 - ny) * 2.7;
    }
    settingsDirtyRef.current = true;
    syncSettingsToUI();

    // Record XY automation into timeline with strong throttling + delta filter
    // so long recordings don't overload timeline and freeze export.
    if (timelineRecordingRef.current && audioStateRef.current.duration > 0) {
      const now = performance.now();
      const values = liveXYMode === 'color'
        ? { a: settingsLiveRef.current.hueRotation, b: settingsLiveRef.current.masterIntensity }
        : liveXYMode === 'motion'
          ? { a: settingsLiveRef.current.speed, b: settingsLiveRef.current.geoRotationSpeed }
          : { a: settingsLiveRef.current.geoScale, b: settingsLiveRef.current.geoDepth };
      const prev = liveXYLastRecordedRef.current;
      const delta = prev ? Math.abs(values.a - prev.a) + Math.abs(values.b - prev.b) : 999;
      if (now - liveXYLastMarkerMsRef.current >= 320 && delta >= 0.06) {
        liveXYLastMarkerMsRef.current = now;
        liveXYLastRecordedRef.current = values;
        const preset: Partial<VisualizerSettings> = liveXYMode === 'color'
          ? { hueRotation: values.a, masterIntensity: values.b }
          : liveXYMode === 'motion'
            ? { speed: values.a, geoRotationSpeed: values.b }
            : { geoScale: values.a, geoDepth: values.b };
        addTimelineMarker({
          time: audioStateRef.current.currentTime,
          type: 'preset',
          label: `XY ${liveXYMode}`,
          preset,
        });
      }
    }
  }, [liveXYMode, syncSettingsToUI]);

  const toggleLiveAutoZoom = useCallback(() => {
    if (liveAutoZoomEnabledRef.current) {
      // Pause: keep current zoom position exactly where it is.
      settingsLiveRef.current.geoScale = autoZoomValueRef.current;
      settingsDirtyRef.current = true;
      syncSettingsToUI();
      setLiveAutoZoomEnabled(false);
      return;
    }

    // Start from current position with no jump.
    const start = settingsLiveRef.current.geoScale ?? DEFAULT_SETTINGS.geoScale;
    autoZoomValueRef.current = Math.max(0.4, Math.min(3, start));
    setLiveAutoZoomEnabled(true);
  }, [syncSettingsToUI]);

  useEffect(() => {
    if (!isVisualTransitioning) return;
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - visualTransitionStartRef.current) / Math.max(1, visualTransitionMs);
      const p = Math.max(0, Math.min(1, t));
      setVisualTransitionProgress(p);
      if (p >= 1) {
        setIsVisualTransitioning(false);
        setVisualTransitionPrevMode(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isVisualTransitioning, visualTransitionMs]);

  useEffect(() => {
    if (showLivePanel) setLiveTextDraft(settingsLiveRef.current.customText || '');
  }, [showLivePanel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // Keyboard responsiveness guard:
      // - Block noisy key-repeat for one-shot actions (toggles, triggers, presets)
      // - Keep continuous controls responsive (arrows, +/- style adjustments)
      const continuousKeys = new Set([
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Comma', 'Period', 'Semicolon', 'Quote',
        'BracketLeft', 'BracketRight',
        'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract',
      ]);
      const isContinuousKey = continuousKeys.has(e.code);
      const repeatBlocked = liveInputMode !== 'free';
      if (repeatBlocked && e.repeat && !isContinuousKey) return;
      if (liveInputMode !== 'free' && !isContinuousKey) {
        const now = performance.now();
        const last = keyLastFireRef.current[e.code] || 0;
        const debounceMs = liveInputMode === 'ultra' ? 120 : 70;
        if (now - last < debounceMs) return;
        keyLastFireRef.current[e.code] = now;
      }

      // ─── MODE MAPS ─────────────────────────────────────────────────
      // 1-0: Classic Canvas Visuals (10)
      const numModes: VisualizerMode[] = [
        'bars', 'wave', 'circle', 'particles', 'matrix',          // 1-5
        'kaleidoscope', 'tunnel', 'vortex', 'plasma', 'starfield', // 6-0
      ];
      // Shift+1-0: Shader + Advanced Visuals (10)
      const shiftNumModes: VisualizerMode[] = [
        'fractal_zoom', 'fluid_sim', 'aurora', 'quantum_field', 'neural_net',  // Shift+1-5
        'glitch_city', 'cosmic_web', 'electric_storm', 'cyberflow', 'prism3d', // Shift+6-0
      ];
      // Q-row: remaining visuals (T = text!)
      const qRowModes: Record<string, VisualizerMode> = {
        'KeyQ': 'metaballs', 'KeyW': 'lissajous', 'KeyE': 'dna',
        'KeyT': 'text', 'KeyY': 'territory', 'KeyU': 'rings',
        'KeyR': 'smoke',
      };
      // Shift+Q-row: more remaining visuals
      const shiftQRowModes: Record<string, VisualizerMode> = {
        'KeyQ': 'grid_warp', 'KeyW': 'chrysanthemum', 'KeyE': 'oscilloscope',
      };
      // Layer 2 modes (Ctrl+1-0)
      const layer2Modes: VisualizerMode[] = [
        'bars', 'wave', 'circle', 'particles', 'vortex',
        'plasma', 'starfield', 'kaleidoscope', 'dna', 'rings',
      ];
      const blendModes: VisualizerSettings['blendMode'][] = ['screen', 'multiply', 'overlay', 'difference', 'exclusion'];
      const allModes: VisualizerMode[] = [
        ...numModes,
        ...shiftNumModes,
        'metaballs', 'lissajous', 'dna', 'text', 'territory', 'rings', 'smoke', 'grid_warp', 'chrysanthemum', 'oscilloscope',
      ];

      const s = settingsForEngineRef.current;

      // ─── TRANSPORT ──────────────────────────────────────────────────
      if (e.code === 'Space') { e.preventDefault(); handleTogglePlay(); }
      else if (e.code === 'KeyM' && e.ctrlKey && !e.altKey && !e.metaKey) { handleToggleMute(); }
      else if (e.code === 'ArrowRight' && !e.shiftKey) { handleNextTrack(); }
      else if (e.code === 'ArrowLeft' && !e.shiftKey) { handlePrevTrack(); }
      // PERFORMANCE FIRST:
      // Ctrl+1-0 => presets 1-10, Ctrl+Shift+1-0 => presets 11-20
      // (Avoids browser Cmd+number tab-switch conflicts on macOS)
      else if (e.ctrlKey && !e.metaKey && e.code.startsWith('Digit')) {
        e.preventDefault();
        const digit = parseInt(e.code.replace('Digit', ''));
        const idx = digit === 0 ? 9 : digit - 1;
        const base = e.shiftKey ? 10 : 0;
        handleApplyPreset(PRESETS[base + idx]?.settings || {});
      }
      // Shift+Arrow: seek ±5s
      else if (e.code === 'ArrowRight' && e.shiftKey && audioRef.current) {
        audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, (audioRef.current.currentTime || 0) + 5);
      }
      else if (e.code === 'ArrowLeft' && e.shiftKey && audioRef.current) {
        audioRef.current.currentTime = Math.max(0, (audioRef.current.currentTime || 0) - 5);
      }
      // ArrowUp/Down: volume ±5%
      else if (e.code === 'ArrowUp') {
        e.preventDefault();
        const nv = Math.min(1, (audioRef.current?.volume || 0.7) + 0.05);
        if (audioRef.current) audioRef.current.volume = nv;
        setAudioState(prev => ({ ...prev, volume: nv }));
      }
      else if (e.code === 'ArrowDown') {
        e.preventDefault();
        const nv = Math.max(0, (audioRef.current?.volume || 0.7) - 0.05);
        if (audioRef.current) audioRef.current.volume = nv;
        setAudioState(prev => ({ ...prev, volume: nv }));
      }

      // ─── PRIMARY MODE: 1-0 ─────────────────────────────────────────
      else if (!e.shiftKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
        handleSettingChange('mode', numModes[parseInt(e.key) - 1]);
      }
      else if (!e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === '0') {
        handleSettingChange('mode', numModes[9]);
      }
      // Live panel visual bank hotkeys: C/D
      else if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'KeyC') {
        setShowLivePanel(true);
        setLiveVisualBank('C');
      }
      else if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'KeyD') {
        setShowLivePanel(true);
        setLiveVisualBank('D');
      }

      // ─── SHADER/ADVANCED MODE: Shift+1-0 ───────────────────────────
      else if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.code.startsWith('Digit')) {
        const digit = parseInt(e.code.replace('Digit', ''));
        const idx = digit === 0 ? 9 : digit - 1;
        if (idx >= 0 && idx < shiftNumModes.length) handleSettingChange('mode', shiftNumModes[idx]);
      }

      // ─── Q-ROW: remaining modes ────────────────────────────────────
      else if (!e.shiftKey && !e.ctrlKey && !e.metaKey && qRowModes[e.code]) {
        handleSettingChange('mode', qRowModes[e.code]);
      }
      // Shift+Q-row: even more modes
      else if (e.shiftKey && !e.ctrlKey && !e.metaKey && shiftQRowModes[e.code]) {
        handleSettingChange('mode', shiftQRowModes[e.code]);
      }

      // ─── LAYER 2 (Alt+1-0, L toggle, B blend cycle) ───────────────
      else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code.startsWith('Digit')) {
        e.preventDefault();
        const idx = parseInt(e.code.replace('Digit', ''));
        const li = idx === 0 ? 9 : idx - 1;
        if (li < layer2Modes.length) handleSettingChange('layer2Mode', layer2Modes[li]);
      }
      else if (e.code === 'KeyL' && e.altKey && !e.ctrlKey && !e.metaKey) {
        handleSettingChange('layer2Mode', s.layer2Mode === 'none' ? 'vortex' : 'none');
      }
      else if (e.code === 'KeyB' && e.altKey && !e.ctrlKey && !e.metaKey) {
        const cur = blendModes.indexOf(s.layer2BlendMode as typeof blendModes[number]);
        handleSettingChange('layer2BlendMode', blendModes[(cur + 1) % blendModes.length]);
      }

      // ─── FX TOGGLES (F1-F10) ───────────────────────────────────────
      else if (e.code === 'F1') { e.preventDefault(); handleSettingChange('bloom', !s.bloom); }
      else if (e.code === 'F2') { e.preventDefault(); handleSettingChange('glitch', !s.glitch); }
      else if (e.code === 'F3') { e.preventDefault(); handleSettingChange('feedback', !s.feedback); }
      else if (e.code === 'F4') { e.preventDefault(); handleSettingChange('mirror', !s.mirror); }
      else if (e.code === 'F5') { e.preventDefault(); handleSettingChange('scanlines', !s.scanlines); }
      else if (e.code === 'F6') { e.preventDefault(); handleSettingChange('vignette', !s.vignette); }
      else if (e.code === 'F7') { e.preventDefault(); handleSettingChange('kaleidoscope', !s.kaleidoscope); }
      else if (e.code === 'F8') { e.preventDefault(); handleSettingChange('strobeEnabled', !s.strobeEnabled); }
      else if (e.code === 'F9') { e.preventDefault(); handleSettingChange('fluidParticlesEnabled', !s.fluidParticlesEnabled); }
      else if (e.code === 'F10') { e.preventDefault(); handleSettingChange('automationEnabled', !s.automationEnabled); }

      // ─── PRO ACTIONS ────────────────────────────────────────────────
      else if (e.code === 'KeyH' && e.altKey && !e.ctrlKey && !e.metaKey) {
        manualHitRef.current = 1.0;
        if (timelineRecordingRef.current && audioStateRef.current.duration > 0)
          addTimelineMarker({ time: audioStateRef.current.currentTime, type: 'action', label: 'HIT', action: 'hit' });
      }
      else if (e.code === 'KeyX' && e.altKey && !e.ctrlKey && !e.metaKey) {
        cutFramesRef.current = 4;
        if (timelineRecordingRef.current && audioStateRef.current.duration > 0)
          addTimelineMarker({ time: audioStateRef.current.currentTime, type: 'action', label: 'CUT', action: 'cut' });
      }
      else if (e.code === 'KeyC' && e.altKey && !e.ctrlKey && !e.metaKey) {
        engineOverridesRef.current = {};
        manualHitRef.current = 0;
        cutFramesRef.current = 0;
        sweepPosRef.current = 0;
        if (timelineRecordingRef.current && audioStateRef.current.duration > 0)
          addTimelineMarker({ time: audioStateRef.current.currentTime, type: 'action', label: 'CLEAR', action: 'clear' });
      }

      // ─── FEATURE TOGGLES (performance-safe modifier keys) ───────────
      else if (e.code === 'KeyZ' && e.ctrlKey && e.altKey && !e.metaKey) { setIsZenMode(prev => !prev); } // ZEN
      else if (e.code === 'KeyL' && e.ctrlKey && e.altKey && !e.metaKey) { setShowLivePanel(prev => !prev); } // LIVE PANEL
      // INFO moved to Ctrl+Alt+I (single-key toggle is risky in performance)
      else if (e.code === 'KeyI' && e.ctrlKey && e.altKey && !e.metaKey) { setShowInfo(prev => !prev); }
      // R removed — Recording is UI-only (too destructive for single key: resets song to 0:00)
      // Screenshot moved to Ctrl+Alt+P (prevents accidental trigger while performing)
      else if (e.code === 'KeyP' && e.ctrlKey && e.altKey && !e.metaKey) {                 // PNG Screenshot
        const canvas = document.querySelector('main canvas') as HTMLCanvasElement;
        if (canvas) { const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `prism-${Date.now()}.png`; a.click(); }
      }
      else if (e.code === 'KeyA' && e.ctrlKey && e.altKey && !e.metaKey) {                  // AUTO PRESETS toggle
        setAutoPresetEnabled(prev => !prev);
        lastAutoPresetTimeRef.current = Date.now() / 1000;
      }
      else if (e.code === 'KeyD' && e.ctrlKey && e.altKey && !e.metaKey) {                  // BEAT SYNC toggle
        handleSettingChange('beatSync', !s.beatSync);
      }
      else if (e.code === 'KeyG' && e.ctrlKey && e.altKey && !e.metaKey) {                  // HARMONIC COLOR toggle
        handleSettingChange('harmonicColorEnabled', !s.harmonicColorEnabled);
      }
      else if (e.code === 'KeyN' && e.ctrlKey && e.altKey && !e.metaKey) {                  // NOISE cycle (0 → 0.3 → 0.6 → 1.0 → 0)
        const noiseSteps = [0, 0.3, 0.6, 1.0];
        const curIdx = noiseSteps.findIndex(v => Math.abs(v - (s.noise || 0)) < 0.05);
        handleSettingChange('noise', noiseSteps[(curIdx + 1) % noiseSteps.length]);
      }
      else if (e.code === 'KeyO' && e.ctrlKey && e.altKey && !e.metaKey) {                  // CHROMATIC ABERRATION cycle
        const caSteps = [0, 0.3, 0.6, 1.0];
        const curIdx = caSteps.findIndex(v => Math.abs(v - (s.chromaticAberration || 0)) < 0.05);
        handleSettingChange('chromaticAberration', caSteps[(curIdx + 1) % caSteps.length]);
      }
      else if (e.code === 'KeyJ' && e.ctrlKey && e.altKey && !e.metaKey) {                  // SWEEP toggle
        handleSettingChange('sweepEnabled', !s.sweepEnabled);
      }
      else if (e.code === 'KeyK' && e.ctrlKey && e.altKey && !e.metaKey) {                  // LFO toggle
        handleSettingChange('lfoEnabled', !s.lfoEnabled);
      }
      else if (e.code === 'KeyV' && e.ctrlKey && e.altKey && !e.metaKey) {                  // TRANSITION MORPH toggle
        handleSettingChange('transitionMorphEnabled', !s.transitionMorphEnabled);
      }
      else if (e.code === 'KeyS' && e.ctrlKey && e.altKey && !e.metaKey) {                  // STROBE toggle
        handleSettingChange('strobeEnabled', !s.strobeEnabled);
      }
      else if (e.code === 'Comma') {                                        // SPEED down
        handleSettingChange('speed', Math.max(0.1, (s.speed || 1) - 0.1));
      }
      else if (e.code === 'Period') {                                       // SPEED up
        handleSettingChange('speed', Math.min(5, (s.speed || 1) + 0.1));
      }
      else if (e.code === 'Semicolon') {                                    // SMOOTHING down
        handleSettingChange('smoothing', Math.max(0, (s.smoothing || 0.8) - 0.05));
      }
      else if (e.code === 'Quote') {                                        // SMOOTHING up
        handleSettingChange('smoothing', Math.min(0.99, (s.smoothing || 0.8) + 0.05));
      }
      else if (e.code === 'Backquote') {                                    // RANDOM PRESET (Tilde/`)
        if (PRESETS.length > 0) {
          const idx = Math.floor(Math.random() * PRESETS.length);
          handleApplyPreset(PRESETS[idx].settings);
        }
      }

      // ─── INTENSITY +/- ─────────────────────────────────────────────
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        handleSettingChange('masterIntensity', Math.min(3, (s.masterIntensity || 1) + 0.1));
      }
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        handleSettingChange('masterIntensity', Math.max(0.1, (s.masterIntensity || 1) - 0.1));
      }

      // ─── GEOMETRY SCALE [/] ────────────────────────────────────────
      else if (e.code === 'BracketLeft') {
        handleSettingChange('geoScale', Math.max(0.1, (s.geoScale || 1) - 0.1));
      }
      else if (e.code === 'BracketRight') {
        handleSettingChange('geoScale', Math.min(3, (s.geoScale || 1) + 0.1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlay, handleToggleMute, handleNextTrack, handlePrevTrack]);

  // Memoized callbacks for AudioControls (prevents React.memo bypass)
  const handleModeChange = useCallback((mode: VisualizerMode) => handleSettingChange('mode', mode), [handleSettingChange]);
  const handleToggleRecording = useCallback(() => { if (isRecording) stopRecording(); else startRecording(); }, [isRecording, stopRecording, startRecording]);
  const handleReset = useCallback(() => { settingsLiveRef.current = { ...DEFAULT_SETTINGS }; settingsDirtyRef.current = true; syncSettingsToUI(); }, [syncSettingsToUI]);
  const getFreqDataCb = useCallback(() => analyzerRef.current?.getFrequencyData() || new Uint8Array(0), []);
  const getTimeDataCb = useCallback(() => analyzerRef.current?.getTimeDomainData() || new Uint8Array(0), []);

  // Helper: render a visualizer for a given mode
  // Merge layer2Mode into secondaryMode so VisualizerCanvas renders both on one canvas
  // Merged settings: reads live ref, not React state
  // This getter is called by renderVisualizer each React render
  // But the visualizer components read settingsRef internally each FRAME
  const isShaderLayer2 = SHADER_MODES.includes(settings.layer2Mode as VisualizerMode);

  const mergedSettings = (() => {
    const s = settingsLiveRef.current;
    // Canvas layer-2 is merged into VisualizerCanvas as secondaryMode.
    // Shader layer-2 is rendered as a dedicated overlay component (below in JSX).
    if (s.layer2Mode !== 'none' && !SHADER_MODES.includes(s.layer2Mode as VisualizerMode)) {
      return { ...s, secondaryMode: s.layer2Mode, blendMode: s.layer2BlendMode };
    }
    return s;
  })();

  // Pass merged settings (layer2 → secondaryMode) to visualizers
  const renderVisualizer = (mode: VisualizerMode, allowLayer2Merge = true) => {
    const raw = settingsLiveRef.current;
    // Merge layer2 into secondaryMode so VisualizerCanvas renders both layers on one canvas
    const shouldMergeLayer2 = allowLayer2Merge && raw.layer2Mode !== 'none' && !SHADER_MODES.includes(raw.layer2Mode as VisualizerMode);
    const merged = shouldMergeLayer2
      ? { ...raw, secondaryMode: raw.layer2Mode, blendMode: raw.layer2BlendMode }
      : raw;
    // Ensure sub-visualizers receive the actual requested mode (important for shader layer 2).
    const s = merged.mode === mode ? merged : { ...merged, mode };
    const eo = engineOverridesRef;
    if (mode === 'prism3d') return <Visualizer3D getFrequencyData={getFreqDataCb} settings={s} mousePos={mousePos} handPos={handPos} engineOverrides={eo} />;
    if (mode === 'cyberflow') return <CyberflowVisualizer getFrequencyData={getFreqDataCb} settings={s} mousePos={mousePos} handPos={handPos} engineOverrides={eo} />;
    if (SHADER_MODES.includes(mode)) return <ShaderVisualizer getFrequencyData={getFreqDataCb} settings={s} mousePos={mousePos} handPos={handPos} engineOverrides={eo} />;
    return <VisualizerCanvas getFrequencyData={getFreqDataCb} getTimeDomainData={getTimeDataCb} settings={s} mousePos={mousePos} handPos={handPos} engineOverrides={eo} />;
  };

  return (
    <ErrorBoundary>
      <div className={`flex h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white/20 transition-all duration-700 overflow-hidden border-2 border-[#8B6914]/30 ${isZenMode ? 'cursor-none border-transparent' : ''}`}>
        
        {/* LEFT PANEL: Mode Selector */}
        {!isZenMode && (
            <aside
              className="w-[180px] border-r border-[#8B6914]/20 flex flex-col bg-[#0a0a0a]/95 z-20 overflow-hidden"
            >
              <div className="px-3 py-3 border-b border-[#8B6914]/20 flex items-center gap-2">
                <div className="w-6 h-6 bg-gradient-to-br from-[#8B6914] to-[#D4A537] rounded-md flex items-center justify-center">
                  <Zap size={12} className="text-black fill-black" />
                </div>
                <h1 className="text-[11px] font-bold tracking-wider uppercase font-display text-[#D4A537]">Prism Pro</h1>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar py-2">
                {/* Shader Visuals */}
                <div className="px-2 mb-1">
                  <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#8B6914]/60">Shader Visuals</span>
                </div>
                {(['fractal_zoom', 'fluid_sim', 'aurora', 'quantum_field', 'neural_net', 'glitch_city', 'cosmic_web', 'electric_storm', 'cyberflow', 'prism3d'] as const).map(m => (
                  <button key={m} onClick={() => handleSettingChange('mode', m)}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                      settings.mode === m ? 'bg-[#8B6914]/20 text-[#D4A537] border-l-2 border-[#D4A537]' : 'text-white/40 hover:bg-white/5 hover:text-white/60 border-l-2 border-transparent'
                    }`}>{m.replace('_', ' ').replace('fractal zoom', 'fractl').replace('fluid sim', 'fluid').replace('quantum field', 'quantm').replace('neural net', 'neural').replace('prism3d', 'prism').replace('glitch city', 'glitch').replace('cosmic web', 'cosmic').replace('electric storm', 'storm')}</button>
                ))}

                {/* Canvas Visuals */}
                <div className="px-2 mt-3 mb-1">
                  <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#8B6914]/60">Classic Visuals</span>
                </div>
                {(['bars', 'wave', 'circle', 'particles', 'matrix', 'kaleidoscope', 'tunnel', 'text', 'vortex', 'plasma', 'starfield', 'metaballs', 'lissajous', 'dna', 'territory', 'rings', 'grid_warp', 'chrysanthemum', 'oscilloscope', 'smoke'] as const).map(m => (
                  <button key={m} onClick={() => handleSettingChange('mode', m)}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                      settings.mode === m ? 'bg-[#8B6914]/20 text-[#D4A537] border-l-2 border-[#D4A537]' : 'text-white/40 hover:bg-white/5 hover:text-white/60 border-l-2 border-transparent'
                    }`}>{m === 'kaleidoscope' ? 'kaleido' : m === 'metaballs' ? 'liquid' : m === 'starfield' ? 'stars' : m === 'particles' ? 'nebula' : m === 'territory' ? 'terrwar' : m === 'grid_warp' ? 'gridwarp' : m === 'chrysanthemum' ? 'flower' : m === 'oscilloscope' ? 'scope' : m}</button>
                ))}

                {/* Shader / Advanced Visuals */}
                <div className="px-2 mt-3 mb-1">
                  <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#8B6914]/60">Shader Visuals</span>
                </div>
                {(['fractal_zoom', 'fluid_sim', 'aurora', 'quantum_field', 'neural_net', 'glitch_city', 'cosmic_web', 'electric_storm', 'cyberflow', 'prism3d'] as const).map(m => (
                  <button key={m} onClick={() => handleSettingChange('mode', m)}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                      settings.mode === m ? 'bg-[#8B6914]/20 text-[#D4A537] border-l-2 border-[#D4A537]' : 'text-white/40 hover:bg-white/5 hover:text-white/60 border-l-2 border-transparent'
                    }`}>{m === 'fractal_zoom' ? 'fractal' : m === 'fluid_sim' ? 'fluid' : m === 'quantum_field' ? 'quantum' : m === 'neural_net' ? 'neural' : m === 'glitch_city' ? 'glitch' : m === 'cosmic_web' ? 'cosmic' : m === 'electric_storm' ? 'storm' : m === 'cyberflow' ? 'cyber' : m === 'prism3d' ? '3d prism' : m}</button>
                ))}
              </div>

              {/* Transport at bottom of left panel */}
              <div className="border-t border-[#8B6914]/20 p-2">
                <div className="flex items-center gap-1 justify-center">
                  <button onClick={handleTogglePlay} className="p-1.5 hover:bg-white/10 rounded transition-colors">
                    {audioState.isPlaying ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" className="ml-0.5" />}
                  </button>
                  <span className="text-[8px] font-mono text-white/30 truncate max-w-[100px]">
                    {audioState.fileName ? audioState.fileName.slice(0, 15) : 'No file'}
                  </span>
                </div>
              </div>
            </aside>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          {/* Header (Minimal) */}
          {!isZenMode && (
              <header
                className="h-10 border-b border-[#8B6914]/10 flex items-center justify-between px-4 bg-[#0a0a0a]/60 z-10"
              >
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-mono text-white/50 truncate max-w-[250px]">
                    {audioState.fileName || 'No track'}
                  </span>
                  {detectedKey && settings.harmonicColorEnabled && (
                    <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                      <span className="text-[8px] font-bold text-purple-400 uppercase tracking-widest">{detectedKey}</span>
                    </div>
                  )}
                  {transitionPhase && transitionPhase !== 'idle' && settings.transitionMorphEnabled && (
                    <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      <span className="text-[8px] font-bold text-cyan-400 uppercase tracking-widest">{transitionPhase}</span>
                    </div>
                  )}
                  {settings.ndiOutputEnabled && (
                    <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-[8px] font-bold text-green-400 uppercase tracking-widest">NDI Out</span>
                    </div>
                  )}
                  {isRecording && (
                    <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[8px] font-bold text-red-500 uppercase tracking-widest">Rec</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {audioState.playlist.length > 0 && (
                    <span className="text-[9px] font-mono text-white/30">
                      {audioState.currentIndex + 1}/{audioState.playlist.length}
                    </span>
                  )}
                  <button
                    onClick={() => setIsZenMode(true)}
                    className="p-1.5 rounded hover:bg-white/5 text-white/30 hover:text-white transition-colors"
                    title="Zen Mode (Z)"
                  >
                    <Maximize2 size={16} />
                  </button>
                </div>
              </header>
            )}

          {/* Main Visualizer Area */}
          <main className="flex-1 relative overflow-hidden bg-black group">
            {/* Background Media Layer */}
            {settings.backgroundUrl && settings.backgroundType !== 'none' && (
              <div 
                className="absolute inset-0 z-0 pointer-events-none overflow-hidden"
                style={{
                  opacity: settings.backgroundOpacity,
                  filter: `blur(${settings.backgroundBlur}px) saturate(${settings.backgroundSaturate})`
                }}
              >
                {settings.backgroundType === 'image' ? (
                  <img 
                    src={settings.backgroundUrl} 
                    className="w-full h-full object-cover scale-105" 
                    alt="Background" 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <video 
                    src={settings.backgroundUrl} 
                    autoPlay 
                    loop 
                    muted 
                    playsInline
                    className="w-full h-full object-cover scale-105" 
                  />
                )}
              </div>
            )}

            {/* Background Atmosphere */}
            <div
              className="absolute inset-0 opacity-10 pointer-events-none transition-colors duration-1000"
              style={{
                background: `radial-gradient(circle at 50% 50%, ${settings.colorPrimary}15 0%, transparent 60%)`
              }}
            />
            
            {/* Layer 1: Primary Visual with transition engine */}
            <div className="absolute inset-0 z-[1]">
              <HandTracker
                enabled={settings.gestureControl}
                showPreview={settings.showCameraPreview}
                onHandUpdate={setHandPos}
              />
              {isVisualTransitioning && visualTransitionPrevMode && (
                <div
                  className="absolute inset-0"
                  style={{
                    opacity: visualTransitionType === 'cut'
                      ? (visualTransitionProgress < 0.5 ? 1 : 0)
                      : (1 - visualTransitionProgress),
                    filter: visualTransitionType === 'melt'
                      ? `blur(${(visualTransitionProgress * 8).toFixed(2)}px) saturate(${Math.max(0.2, 1 - visualTransitionProgress * 0.6).toFixed(2)})`
                      : 'none',
                  }}
                >
                  {renderVisualizer(visualTransitionPrevMode)}
                </div>
              )}
              <div
                className="absolute inset-0"
                style={{
                  opacity: visualTransitionType === 'cut'
                    ? (visualTransitionProgress >= 0.5 ? 1 : 0)
                    : (isVisualTransitioning ? visualTransitionProgress : 1),
                  filter: visualTransitionType === 'melt'
                    ? `blur(${((1 - visualTransitionProgress) * 1.5).toFixed(2)}px)`
                    : 'none',
                }}
              >
                {renderVisualizer(mergedSettings.mode)}
              </div>
              {isVisualTransitioning && visualTransitionType === 'cut' && (
                <div
                  className="absolute inset-0 bg-black pointer-events-none"
                  style={{
                    opacity: visualTransitionProgress < 0.5
                      ? Math.max(0, (visualTransitionProgress - 0.35) / 0.15)
                      : Math.max(0, (0.65 - visualTransitionProgress) / 0.15),
                  }}
                />
              )}
            </div>

            {/* Layer 2 shader overlay (for fractal..storm etc.). Canvas layer2 is merged in VisualizerCanvas. */}
            {isShaderLayer2 && settings.layer2Mode !== 'none' && (
              <div
                className="absolute inset-0 z-[2] pointer-events-none"
                style={{ mixBlendMode: settings.layer2BlendMode as React.CSSProperties['mixBlendMode'], opacity: settings.layer2Opacity }}
              >
                {renderVisualizer(settings.layer2Mode as VisualizerMode, false)}
              </div>
            )}

            {/* Layer 3: Fluid Particles Overlay */}
            {settings.fluidParticlesEnabled && (
              <div className="absolute inset-0 z-[3] pointer-events-none">
                <FluidParticles
                  getFrequencyData={() => analyzerRef.current?.getFrequencyData() || new Uint8Array(0)}
                  settings={settings}
                />
              </div>
            )}

            {/* Layer 4: Global Text Overlay (works above both visual layers) */}
            {settings.textOverlayEnabled && settings.mode !== 'text' && settings.layer2Mode !== 'text' && (
              <div
                className="absolute inset-0 z-[4] pointer-events-none"
                style={{ mixBlendMode: settings.textBlendMode as React.CSSProperties['mixBlendMode'] }}
              >
                {renderVisualizer('text', false)}
              </div>
            )}

            {/* Fade In/Out Overlay — driven by engine loop ref, zero re-renders */}
            <div ref={fadeOverlayRef}
              className="absolute inset-0 z-[6] pointer-events-none bg-black"
              style={{ opacity: 0, transition: 'opacity 0.1s linear' }}
            />

            {/* Zen Mode Toggle Button (Visible on hover) */}
            <button 
              onClick={() => setIsZenMode(!isZenMode)}
              className="absolute top-8 right-8 p-3 bg-black/40 backdrop-blur-md border border-white/10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-30"
              title="Zen Mode (Z)"
            >
              <Maximize2 size={20} className="text-white/60" />
            </button>

            {/* Live Performance Panel (Ctrl+Alt+L) */}
            <button
              onClick={() => setShowLivePanel(prev => !prev)}
              className="absolute top-8 left-8 px-3 py-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white hover:bg-black/55 transition-colors z-30"
              title="Live Panel (Ctrl+Alt+L)"
            >
              Live
            </button>
            {showLivePanel && (
              <div className="absolute top-20 left-8 z-40 w-[340px] max-w-[calc(100%-2rem)] rounded-xl border border-[#8B6914]/40 bg-black/65 backdrop-blur-md p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#D4A537]">Live Panel</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleSettingChange('textOverlayEnabled', !settings.textOverlayEnabled)}
                      className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest border ${
                        settings.textOverlayEnabled ? 'bg-[#8B6914]/30 border-[#8B6914]/50 text-[#D4A537]' : 'bg-white/10 border-white/20 text-white/65 hover:bg-white/20'
                      }`}
                      title="Text overlay on/off"
                    >
                      T
                    </button>
                    <button
                      onClick={() => setLivePanelLocked(prev => !prev)}
                      className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest border ${
                        livePanelLocked ? 'bg-[#8B6914]/30 border-[#8B6914]/50 text-[#D4A537]' : 'bg-white/10 border-white/20 text-white/65'
                      }`}
                    >
                      Lock
                    </button>
                    <button
                      onClick={() => setLiveInputMode(prev => prev === 'free' ? 'tight' : prev === 'tight' ? 'ultra' : 'free')}
                      className="px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest border bg-white/10 border-white/20 text-white/70 hover:bg-white/20"
                      title="Keyboard input mode"
                    >
                      {liveInputMode}
                    </button>
                    <button
                      onClick={() => setShowLivePanel(false)}
                      className="w-5 h-5 rounded bg-white/10 text-white/70 hover:bg-white/20 text-[10px] font-bold"
                      aria-label="Close live panel"
                    >
                      x
                    </button>
                  </div>
                </div>

                {!livePanelLocked && (
                  <>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] font-bold uppercase tracking-wider text-white/45">Transition</span>
                        <div className="flex gap-1">
                          {(['fade', 'cut', 'melt'] as const).map((tp) => (
                            <button
                              key={tp}
                              onClick={() => setVisualTransitionType(tp)}
                              className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase border ${
                                visualTransitionType === tp ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/45'
                              }`}
                            >
                              {tp}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-mono text-white/35 w-10">ms</span>
                        <input
                          type="range"
                          min="120"
                          max="1200"
                          step="20"
                          value={visualTransitionMs}
                          onChange={(e) => setVisualTransitionMs(parseInt(e.target.value, 10))}
                          className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#D4A537]"
                        />
                        <span className="text-[8px] font-mono text-white/40 w-10 text-right">{visualTransitionMs}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[8px] font-bold uppercase tracking-wider text-white/45">Preset Bank</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setLivePresetBank('A')}
                          className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${livePresetBank === 'A' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/45'}`}
                        >
                          A
                        </button>
                        <button
                          onClick={() => setLivePresetBank('B')}
                          className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${livePresetBank === 'B' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/45'}`}
                        >
                          B
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {(livePresetBank === 'A' ? PRESETS.slice(0, 10) : PRESETS.slice(10, 20)).map((preset) => (
                        <button
                          key={preset.name}
                          onClick={() => handleApplyPreset(preset.settings)}
                          className="px-1.5 py-1.5 rounded bg-white/10 hover:bg-white/20 border border-white/10 text-[7px] font-bold uppercase tracking-wider text-white/75"
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[8px] font-bold uppercase tracking-wider text-white/45">Visual Bank</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setLiveVisualBank('C')}
                          className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${liveVisualBank === 'C' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/45'}`}
                        >
                          C
                        </button>
                        <button
                          onClick={() => setLiveVisualBank('D')}
                          className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${liveVisualBank === 'D' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/45'}`}
                        >
                          D
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {(liveVisualBank === 'C'
                        ? ([
                            'bars', 'wave', 'circle', 'particles', 'matrix',
                            'kaleidoscope', 'tunnel', 'vortex', 'plasma', 'starfield',
                          ] as const)
                        : ([
                            'fractal_zoom', 'fluid_sim', 'aurora', 'quantum_field', 'neural_net',
                            'glitch_city', 'cosmic_web', 'electric_storm', 'cyberflow', 'prism3d',
                          ] as const)
                      ).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => handleSettingChange('mode', mode)}
                          className={`px-1.5 py-1.5 rounded border text-[7px] font-bold uppercase tracking-wider ${
                            settings.mode === mode ? 'bg-[#8B6914]/30 border-[#8B6914]/50 text-[#D4A537]' : 'bg-white/10 border-white/10 text-white/75 hover:bg-white/20'
                          }`}
                        >
                          {mode.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className={`grid ${livePanelLocked ? 'grid-cols-3' : 'grid-cols-3'} gap-1`}>
                  {[
                    ['Hit', () => { manualHitRef.current = 1.0; recordLiveActionMarker('hit'); }, 'bg-emerald-500/20 border-emerald-500/35 text-emerald-300'],
                    ['Cut', () => { cutFramesRef.current = 4; recordLiveActionMarker('cut'); }, 'bg-red-500/20 border-red-500/35 text-red-300'],
                    ['Clear', () => {
                      engineOverridesRef.current = {};
                      manualHitRef.current = 0;
                      cutFramesRef.current = 0;
                      sweepPosRef.current = 0;
                      recordLiveActionMarker('clear');
                    }, 'bg-white/10 border-white/20 text-white/70'],
                  ].map(([label, onClick, cls]: [string, () => void, string]) => (
                    <button
                      key={label}
                      onClick={onClick}
                      className={`py-1.5 rounded border text-[8px] font-bold uppercase tracking-wider ${cls}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-5 gap-1">
                  <button
                    onClick={() => handleSettingChange('feedback', !settings.feedback)}
                    className={`py-1.5 rounded border text-[8px] font-bold uppercase tracking-wider transition-colors ${
                      settings.feedback ? 'bg-[#8B6914]/25 border-[#8B6914]/45 text-[#D4A537]' : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    Feedback
                  </button>
                  <button
                    onClick={() => handleSettingChange('strobeEnabled', !settings.strobeEnabled)}
                    className={`py-1.5 rounded border text-[8px] font-bold uppercase tracking-wider transition-colors ${
                      settings.strobeEnabled ? 'bg-[#8B6914]/25 border-[#8B6914]/45 text-[#D4A537]' : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    Strobe
                  </button>
                  <button
                    onClick={() => handleSettingChange('mirror', !settings.mirror)}
                    className={`py-1.5 rounded border text-[8px] font-bold uppercase tracking-wider transition-colors ${
                      settings.mirror ? 'bg-[#8B6914]/25 border-[#8B6914]/45 text-[#D4A537]' : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    Mirror
                  </button>
                  <button
                    onClick={() => {
                      settingsLiveRef.current.geoScale = 0.5 + Math.random() * 2.1;
                      settingsLiveRef.current.geoRotationSpeed = Math.random() * 4.5;
                      settingsLiveRef.current.geoSymmetry = 1 + Math.floor(Math.random() * 12);
                      settingsLiveRef.current.geoSegments = 8 + Math.floor(Math.random() * 72);
                      settingsLiveRef.current.geoSpread = 0.4 + Math.random() * 2.2;
                      settingsLiveRef.current.geoDepth = 0.4 + Math.random() * 2.2;
                      settingsLiveRef.current.geoTurbulence = Math.random() * 1.6;
                      settingsLiveRef.current.geoComplexity = 0.5 + Math.random() * 2.0;
                      settingsDirtyRef.current = true;
                      syncSettingsToUI();
                      if (timelineRecordingRef.current && audioStateRef.current.duration > 0) {
                        addTimelineMarker({
                          time: audioStateRef.current.currentTime,
                          type: 'preset',
                          label: 'Geo Rnd',
                          preset: {
                            geoScale: settingsLiveRef.current.geoScale,
                            geoRotationSpeed: settingsLiveRef.current.geoRotationSpeed,
                            geoSymmetry: settingsLiveRef.current.geoSymmetry,
                            geoSegments: settingsLiveRef.current.geoSegments,
                            geoSpread: settingsLiveRef.current.geoSpread,
                            geoDepth: settingsLiveRef.current.geoDepth,
                            geoTurbulence: settingsLiveRef.current.geoTurbulence,
                            geoComplexity: settingsLiveRef.current.geoComplexity,
                          },
                        });
                      }
                    }}
                    className="py-1.5 rounded border bg-cyan-500/15 border-cyan-500/30 text-[8px] font-bold uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/25 transition-colors"
                  >
                    Geo Rnd
                  </button>
                  <button
                    onClick={() => handleSettingChange('fluidParticlesEnabled', !settings.fluidParticlesEnabled)}
                    className={`py-1.5 rounded border text-[8px] font-bold uppercase tracking-wider transition-colors ${
                      settings.fluidParticlesEnabled ? 'bg-[#8B6914]/25 border-[#8B6914]/45 text-[#D4A537]' : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    FX Part
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-white/50">Visual Auto Zoom</span>
                    <button
                      onClick={toggleLiveAutoZoom}
                      className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest border ${
                        liveAutoZoomEnabled ? 'bg-[#8B6914]/30 border-[#8B6914]/50 text-[#D4A537]' : 'bg-white/10 border-white/20 text-white/65 hover:bg-white/20'
                      }`}
                    >
                      {liveAutoZoomEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-mono text-white/35 w-12">Speed</span>
                    <input
                      type="range"
                      min="0.1"
                      max="2.0"
                      step="0.05"
                      value={liveAutoZoomSpeed}
                      onChange={(e) => setLiveAutoZoomSpeed(parseFloat(e.target.value))}
                      className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-[#D4A537]"
                    />
                    <span className="text-[8px] font-mono text-white/40 w-8 text-right">{liveAutoZoomSpeed.toFixed(2)}</span>
                  </div>
                </div>

                {!livePanelLocked && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] font-bold uppercase tracking-wider text-white/50">Live Text</span>
                      <button
                        onClick={() => {
                          handleSettingChange('customText', liveTextDraft || ' ');
                          handleSettingChange('textOverlayEnabled', true);
                        }}
                        className="px-2 py-0.5 rounded bg-[#8B6914]/25 border border-[#8B6914]/45 text-[8px] font-bold uppercase tracking-wider text-[#D4A537]"
                      >
                        Apply
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <input
                        value={liveTextDraft}
                        onChange={(e) => setLiveTextDraft(e.target.value)}
                        placeholder="Type live text..."
                        className="flex-1 px-2 py-1 rounded bg-white/10 border border-white/15 text-[9px] text-white placeholder:text-white/25 outline-none focus:border-[#8B6914]/50"
                      />
                      <button
                        onClick={() => { setLiveTextDraft(''); handleSettingChange('customText', ''); }}
                        className="px-2 py-1 rounded bg-white/10 border border-white/20 text-[8px] font-bold uppercase text-white/60 hover:bg-white/20"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {['DROP', 'ELASTIC', 'NOW PLAYING'].map((phrase) => (
                        <button
                          key={phrase}
                          onClick={() => { setLiveTextDraft(phrase); handleSettingChange('customText', phrase); handleSettingChange('textOverlayEnabled', true); }}
                          className="py-1 rounded bg-white/10 border border-white/15 text-[7px] font-bold uppercase tracking-wider text-white/70 hover:bg-white/20"
                        >
                          {phrase}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        ['Neon', 'neon_sign'],
                        ['Circuit', 'circuit_text'],
                        ['Flame', 'flame_text'],
                        ['Glitch', 'glitch_matrix'],
                      ].map(([label, mode]) => (
                        <button
                          key={label}
                          onClick={() => {
                            handleSettingChange('textDisplayMode', mode as VisualizerSettings['textDisplayMode']);
                            handleSettingChange('textOverlayEnabled', true);
                          }}
                          className={`py-1 rounded border text-[7px] font-bold uppercase tracking-wider ${
                            settings.textDisplayMode === mode ? 'bg-[#8B6914]/25 border-[#8B6914]/45 text-[#D4A537]' : 'bg-white/10 border-white/15 text-white/65 hover:bg-white/20'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleSettingChange('textStroke', !settings.textStroke)}
                        className={`flex-1 py-1 rounded border text-[7px] font-bold uppercase tracking-wider ${
                          settings.textStroke ? 'bg-[#8B6914]/25 border-[#8B6914]/45 text-[#D4A537]' : 'bg-white/10 border-white/15 text-white/65 hover:bg-white/20'
                        }`}
                      >
                        Outline
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1">
                  {[
                    ['BEAT', settings.beatSync, 'beatSync'],
                    ['BLOOM', settings.bloom, 'bloom'],
                    ['GLITCH', settings.glitch, 'glitch'],
                    ['FDBK', settings.feedback, 'feedback'],
                    ['STRB', settings.strobeEnabled, 'strobeEnabled'],
                    ['TXT', settings.textOverlayEnabled, 'textOverlayEnabled'],
                  ].map(([label, active, key]) => (
                    <button
                      key={String(label)}
                      onClick={() => handleSettingChange(key as keyof VisualizerSettings, !active)}
                      className={`px-2 py-1 rounded text-[8px] font-bold uppercase tracking-wider border transition-colors ${
                        active ? 'bg-[#8B6914]/25 border-[#8B6914]/45 text-[#D4A537]' : 'bg-white/5 border-white/10 text-white/35 hover:bg-white/15'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-bold uppercase tracking-wider text-white/50">XY Macro</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setLiveXYMode('color')}
                        className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase border ${liveXYMode === 'color' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/45'}`}
                      >
                        Color
                      </button>
                      <button
                        onClick={() => setLiveXYMode('motion')}
                        className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase border ${liveXYMode === 'motion' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/45'}`}
                      >
                        Motion
                      </button>
                      <button
                        onClick={() => setLiveXYMode('space')}
                        className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase border ${liveXYMode === 'space' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/45'}`}
                      >
                        Space
                      </button>
                    </div>
                  </div>
                  <div
                    ref={liveXYPadRef}
                    className="relative h-28 rounded-lg border border-white/10 bg-gradient-to-br from-[#1a2230] via-[#0f0f14] to-[#2b170a] cursor-crosshair touch-none"
                    onPointerDown={(e) => {
                      setLiveXYDrag(true);
                      const rect = liveXYPadRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      applyLiveXY((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
                    }}
                    onPointerMove={(e) => {
                      if (!liveXYDrag) return;
                      const rect = liveXYPadRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      applyLiveXY((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
                    }}
                    onPointerUp={() => setLiveXYDrag(false)}
                    onPointerLeave={() => setLiveXYDrag(false)}
                  >
                    <div
                      className="absolute w-3 h-3 rounded-full bg-[#D4A537] border border-black/50 pointer-events-none -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_rgba(212,165,55,0.5)]"
                      style={{ left: `${liveXY.x * 100}%`, top: `${liveXY.y * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Share Notification */}
            {shareNotification && (
              <div className="absolute top-8 left-1/2 -translate-x-1/2 px-6 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full z-30">
                <span className="text-sm font-medium text-white">Link copied!</span>
              </div>
            )}

            {/* Idle hint - subtle, bottom corner */}
            {!audioState.fileName && !isMicActive && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none opacity-30">
                <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Drop audio or press Mic</span>
              </div>
            )}
          </main>
        </div>

        {/* RIGHT PANEL: Controls */}
        {!isZenMode && (
            <aside
              className="w-[230px] min-w-[230px] border-l border-[#8B6914]/20 flex flex-col bg-[#0a0a0a]/95 z-20 overflow-y-auto overflow-x-hidden custom-scrollbar"
            >
              <AudioControls
                audioState={audioState}
                settings={settings}
                onTogglePlay={handleTogglePlay}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMute}
                onModeChange={handleModeChange}
                onSettingChange={handleSettingChange}
                onFileUpload={handleFileUpload}
                onToggleMic={handleToggleMic}
                isMicActive={isMicActive}
                onNext={handleNextTrack}
                onPrev={handlePrevTrack}
                onSelectTrack={playTrack}
                isRecording={isRecording}
                onToggleRecording={handleToggleRecording}
                exportQuality={exportQuality}
                onExportQualityChange={setExportQuality}
                onApplyPreset={handleApplyPreset}
                onReset={handleReset}
                getFrequencyData={getFreqDataCb}
                getTimeDomainData={getTimeDataCb}
                mousePos={mousePos}
                autoPresetEnabled={autoPresetEnabled}
                autoPresetInterval={autoPresetInterval}
                onAutoPresetToggle={() => { setAutoPresetEnabled(p => !p); lastAutoPresetTimeRef.current = Date.now() / 1000; }}
                onAutoPresetIntervalChange={setAutoPresetInterval}
                timelineMarkers={timelineMarkers}
                timelineRecording={timelineRecording}
                onTimelineRecordToggle={() => setTimelineRecording(prev => !prev)}
                onTimelineAddMarker={addTimelineMarker}
                onTimelineRemoveMarker={removeTimelineMarker}
                onTimelineNudgeMarker={nudgeTimelineMarker}
                onTimelineClear={clearTimelineMarkers}
                midiEnabled={midiEnabled}
                midiDevices={midiDevices}
                midiMappings={midiMappings}
                midiLearningTarget={midiLearningTarget}
                onMidiEnableToggle={handleMidiEnableToggle}
                onMidiLearnStart={handleMidiLearnStart}
                onMidiLearnCancel={handleMidiLearnCancel}
                onMidiRemoveMapping={handleMidiRemoveMapping}
                midiError={midiError}
              />
            </aside>
        )}

        {/* Hidden Audio Element */}
        <audio 
          ref={audioRef}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setAudioState(prev => ({ ...prev, isPlaying: true }))}
          onPause={() => setAudioState(prev => ({ ...prev, isPlaying: false }))}
          onEnded={() => {
            if (isRecordingRef.current && mediaRecorderRef.current) {
              mediaRecorderRef.current.stop();
              setIsRecording(false);
              return;
            }
            if (audioStateRef.current.playlist.length > 1) {
              handleNextTrack();
            }
          }}
          className="hidden"
        />

        {/* Info Modal */}
        {showInfo && (
          <div
            className="fixed inset-0 bg-black/90 backdrop-blur-xl z-50 flex items-center justify-center p-6"
            onClick={() => setShowInfo(false)}
          >
            <div
              className="max-w-2xl w-full space-y-8"
              onClick={e => e.stopPropagation()}
            >
              <div className="space-y-2">
                <h2 className="text-4xl font-bold tracking-tighter font-display">ELASTIC PRISM PRO</h2>
                <p className="text-white/40 font-mono text-sm uppercase tracking-widest">The Ultimate Audio Visual Suite</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <h3 className="text-[9px] font-bold uppercase tracking-widest text-[#D4A537]">Modes</h3>
                  <div className="space-y-1 text-[8px] font-mono text-white/35">
                    <div className="p-1.5 border border-white/5 rounded">1-9, 0 · Classic Visuals</div>
                    <div className="p-1.5 border border-white/5 rounded">Shift+1-0 · Shader Visuals</div>
                    <div className="p-1.5 border border-white/5 rounded">Q Liquid · W Lissa · E DNA</div>
                    <div className="p-1.5 border border-white/5 rounded">T Text · Y Territory · U Rings</div>
                    <div className="p-1.5 border border-white/5 rounded">R Smoke</div>
                    <div className="p-1.5 border border-white/5 rounded">Shift+Q Grid · Shift+W Flower</div>
                    <div className="p-1.5 border border-white/5 rounded">Shift+E Scope</div>
                    <div className="p-1.5 border border-white/5 rounded">` (Tilde) · Random Preset</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-[9px] font-bold uppercase tracking-widest text-[#D4A537]">Transport & FX</h3>
                  <div className="space-y-1 text-[8px] font-mono text-white/35">
                    <div className="p-1.5 border border-white/5 rounded">Space · Play / Pause</div>
                    <div className="p-1.5 border border-white/5 rounded">Arrow L/R · Prev / Next</div>
                    <div className="p-1.5 border border-white/5 rounded">Shift+Arrow · Seek ±5s</div>
                    <div className="p-1.5 border border-white/5 rounded">Arrow Up/Down · Volume</div>
                    <div className="p-1.5 border border-white/5 rounded">M Mute · +/- Intensity</div>
                    <div className="p-1.5 border border-white/5 rounded">F1-F10 · FX Toggles</div>
                    <div className="p-1.5 border border-white/5 rounded">, / . · Speed Down / Up</div>
                    <div className="p-1.5 border border-white/5 rounded">; / ' · Smoothing ±</div>
                    <div className="p-1.5 border border-white/5 rounded">[ / ] · Geo Scale ±</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-[9px] font-bold uppercase tracking-widest text-[#D4A537]">Pro & Layers</h3>
                  <div className="space-y-1 text-[8px] font-mono text-white/35">
                    <div className="p-1.5 border border-white/5 rounded">H HIT · X CUT · C CLEAR</div>
                    <div className="p-1.5 border border-white/5 rounded">L Layer 2 · B Blend Cycle</div>
                    <div className="p-1.5 border border-white/5 rounded">Alt+1-0 · Layer 2 Mode</div>
                    <div className="p-1.5 border border-white/5 rounded">A Auto · D Beat · S Strobe</div>
                    <div className="p-1.5 border border-white/5 rounded">J Sweep · K LFO · V Morph</div>
                    <div className="p-1.5 border border-white/5 rounded">G Harmonic · N Noise · O CA</div>
                    <div className="p-1.5 border border-white/5 rounded">Ctrl+Alt+P Screenshot</div>
                    <div className="p-1.5 border border-white/5 rounded">Z / F Zen · Ctrl+Alt+I Info</div>
                  </div>
                  <h3 className="text-[9px] font-bold uppercase tracking-widest text-[#D4A537] mt-2">Shift+FX & Presets</h3>
                  <div className="space-y-1 text-[8px] font-mono text-white/35">
                    <div className="p-1.5 border border-white/5 rounded">⇧F Fdbk · ⇧M Mirr · ⇧S Scan</div>
                    <div className="p-1.5 border border-white/5 rounded">⇧B Bloom · ⇧G Glitch · ⇧V Vign</div>
                    <div className="p-1.5 border border-white/5 rounded">⇧Z Inferno · ⇧X Hacker</div>
                    <div className="p-1.5 border border-white/5 rounded">⇧C Kinetic · ⇧N Mandala</div>
                    <div className="p-1.5 border border-white/5 rounded">⇧A Dissolve · ⇧D EQ Type</div>
                    <div className="p-1.5 border border-white/5 rounded">⇧R Neon · ⇧P Gravity</div>
                    <div className="p-1.5 border border-white/5 rounded">⇧Y Tech · ⇧U Ambi · ⇧I Retro</div>
                    <div className="p-1.5 border border-white/5 rounded">⇧O Cyber · ⇧H Liquid · ⇧J Sea</div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowInfo(false)}
                className="w-full py-4 bg-white text-black font-bold uppercase tracking-widest text-xs hover:bg-white/90 transition-colors rounded-xl"
              >
                Close Interface
              </button>
            </div>
          </div>
        )}

        {/* No splash - direct to app */}
      </div>
    </ErrorBoundary>
  );
}
