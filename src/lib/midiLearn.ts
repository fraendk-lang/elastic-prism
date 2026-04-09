/**
 * MIDI Learn System for Elastic Prism Pro
 * Maps MIDI CC messages to visualizer parameters.
 * Writes directly to engineOverridesRef (no React re-renders).
 */

export interface MidiMapping {
  cc: number;
  channel: number;
  param: string;
  min: number;
  max: number;
}

let midiAccess: MIDIAccess | null = null;
let mappings: MidiMapping[] = [];
let learnMode = false;
let learnTarget: string | null = null;
let learnCallback: ((cc: number, channel: number) => void) | null = null;
let valueCallback: ((param: string, value: number) => void) | null = null;
let connectedDevices: string[] = [];
let lastMidiError: string | null = null;

// Load mappings from localStorage
function loadMappings(): MidiMapping[] {
  try {
    const stored = localStorage.getItem('prism_midi_mappings');
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveMappings() {
  localStorage.setItem('prism_midi_mappings', JSON.stringify(mappings));
}

export async function initMidi(
  onValue: (param: string, value: number) => void,
  onDevicesChanged?: (devices: string[]) => void
): Promise<string[]> {
  valueCallback = onValue;
  mappings = loadMappings();
  lastMidiError = null;

  if (!navigator.requestMIDIAccess) {
    console.warn('WebMIDI not supported');
    lastMidiError = 'WebMIDI not supported in this browser';
    return [];
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    const refreshDevices = () => {
      connectedDevices = Array.from(midiAccess?.inputs.values() || []).map(
        input => input.name || 'Unknown Device'
      );
      if (onDevicesChanged) onDevicesChanged(connectedDevices);
    };

    refreshDevices();
    Array.from(midiAccess.inputs.values()).forEach((input) => {
      input.onmidimessage = handleMidiMessage;
    });

    // Listen for new connections
    midiAccess.onstatechange = () => {
      Array.from(midiAccess?.inputs.values() || []).forEach((input) => {
        input.onmidimessage = handleMidiMessage;
      });
      refreshDevices();
    };

    return connectedDevices;
  } catch (err) {
    console.error('MIDI init failed:', err);
    lastMidiError = err instanceof Error ? err.message : String(err);
    return [];
  }
}

function handleMidiMessage(event: MIDIMessageEvent) {
  const [status, cc, value] = event.data;
  const messageType = status & 0xf0;
  const channel = status & 0x0f;

  // Control Change (CC)
  if (messageType === 0xb0) {
    // Learn mode: capture the CC number
    if (learnMode && learnTarget) {
      const mapping: MidiMapping = {
        cc,
        channel,
        param: learnTarget,
        min: 0,
        max: 1,
      };

      // Set sensible ranges based on param name
      if (learnTarget.includes('hueRotation')) { mapping.max = 360; }
      else if (learnTarget.includes('Segments') || learnTarget.includes('geoSegments')) { mapping.min = 3; mapping.max = 64; }
      else if (learnTarget.includes('Symmetry') || learnTarget.includes('geoSymmetry')) { mapping.min = 1; mapping.max = 16; }
      else if (learnTarget.includes('Scale') || learnTarget.includes('geoScale')) { mapping.min = 0.1; mapping.max = 3; }
      else if (learnTarget.includes('Speed') || learnTarget.includes('geoRotationSpeed')) { mapping.max = 5; }
      else if (learnTarget.includes('Intensity') || learnTarget.includes('masterIntensity')) { mapping.max = 2; }
      else if (learnTarget.includes('Opacity') || learnTarget.includes('layer2Opacity')) { mapping.max = 1; }

      // Replace existing mapping for this CC or add new
      mappings = mappings.filter(m => !(m.cc === cc && m.channel === channel));
      mappings.push(mapping);
      saveMappings();

      learnMode = false;
      if (learnCallback) learnCallback(cc, channel);
      learnTarget = null;
      return;
    }

    // Normal mode: apply mapping
    const mapping = mappings.find(m => m.cc === cc && m.channel === channel);
    if (mapping && valueCallback) {
      const normalized = value / 127;
      const mappedValue = mapping.min + normalized * (mapping.max - mapping.min);
      valueCallback(mapping.param, mappedValue);
    }
  }

  // Note On (for button-style toggles)
  if (messageType === 0x90 && value > 0) {
    const mapping = mappings.find(m => m.cc === cc + 128 && m.channel === channel);
    if (mapping && valueCallback) {
      // Toggle: send 1 then 0
      valueCallback(mapping.param, 1);
    }
  }
}

export function startLearn(param: string, callback: (cc: number, channel: number) => void) {
  learnMode = true;
  learnTarget = param;
  learnCallback = callback;
}

export function cancelLearn() {
  learnMode = false;
  learnTarget = null;
  learnCallback = null;
}

export function getMappings(): MidiMapping[] { return mappings; }

export function removeMapping(cc: number, channel: number) {
  mappings = mappings.filter(m => !(m.cc === cc && m.channel === channel));
  saveMappings();
}

export function getConnectedDevices(): string[] { return connectedDevices; }
export function getLastMidiError(): string | null { return lastMidiError; }

export function isLearning(): boolean { return learnMode; }

export function closeMidi() {
  if (midiAccess) {
    midiAccess.inputs.forEach(input => { input.onmidimessage = null; });
  }
  midiAccess = null;
  valueCallback = null;
  connectedDevices = [];
}
