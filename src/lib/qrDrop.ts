/**
 * QR Drop - Live Visual Sharing
 * Generates a shareable URL with live visual state sync.
 * Uses BroadcastChannel for same-device multi-tab sync.
 * For cross-device: encodes current state in URL hash (static snapshot).
 */

import { VisualizerSettings } from '../types';

const CHANNEL_NAME = 'elastic-prism-sync';
let channel: BroadcastChannel | null = null;
let isHost = false;

export function initHost(): void {
  channel = new BroadcastChannel(CHANNEL_NAME);
  isHost = true;
}

export function broadcastState(settings: VisualizerSettings, audioFeatures: { bass: number; mid: number; high: number; bpm: number }): void {
  if (!channel || !isHost) return;
  channel.postMessage({
    type: 'state',
    settings: {
      mode: settings.mode,
      colorPrimary: settings.colorPrimary,
      colorSecondary: settings.colorSecondary,
      masterIntensity: settings.masterIntensity,
      geoScale: settings.geoScale,
      geoRotationSpeed: settings.geoRotationSpeed,
      bloom: settings.bloom,
      glitch: settings.glitch,
    },
    audio: audioFeatures,
    timestamp: Date.now(),
  });
}

export function joinAsClient(onState: (data: { settings: Partial<VisualizerSettings>; audio: { bass: number; mid: number; high: number } }) => void): () => void {
  const clientChannel = new BroadcastChannel(CHANNEL_NAME);
  clientChannel.onmessage = (e) => {
    if (e.data.type === 'state') {
      onState({ settings: e.data.settings, audio: e.data.audio });
    }
  };
  return () => clientChannel.close();
}

export function generateQRData(baseUrl: string, settings: VisualizerSettings): string {
  const compact = {
    m: settings.mode,
    cp: settings.colorPrimary,
    cs: settings.colorSecondary,
    mi: settings.masterIntensity,
    gs: settings.geoScale,
    bl: settings.bloom,
  };
  return `${baseUrl}#qr=${btoa(JSON.stringify(compact))}`;
}

export function cleanup(): void {
  channel?.close();
  channel = null;
  isHost = false;
}
