export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyzer: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private freqArray: Uint8Array | null = null;

  // Smoothed values
  private smoothedBass = 0;
  private smoothedMid = 0;
  private smoothedHigh = 0;
  private smoothedRMS = 0;
  private smoothedCentroid = 0;

  // Beat detection state
  private prevEnergy = 0;
  private beatPhase = 0;
  private lastBeatTime = 0;
  private beatInterval = 500;
  private energyHistory: number[] = [];

  // Kick/Snare detection
  private prevBassEnergy = 0;
  private prevMidEnergy = 0;
  private kickDecay = 0;
  private snareDecay = 0;

  private readonly SMOOTH_ALPHA = 0.15;
  // Faster attack for club reactivity
  private readonly ATTACK_ALPHA = 0.4;
  private readonly RELEASE_ALPHA = 0.08;

  constructor(fftSize: number = 2048) {
    const AudioContextClass = window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext as typeof AudioContext;
    if (!AudioContextClass) {
      console.error("AudioContext is not supported in this browser.");
      return;
    }
    this.audioContext = new AudioContextClass();
    this.analyzer = this.audioContext.createAnalyser();
    this.analyzer.fftSize = fftSize;
    this.dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
    this.freqArray = new Uint8Array(this.analyzer.frequencyBinCount);
  }

  private connectedElement: HTMLAudioElement | null = null;

  async connectElement(element: HTMLAudioElement) {
    if (!this.audioContext || !this.analyzer) return;

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this.connectedElement === element) {
        return;
      }

      if (this.source) {
        try {
          this.source.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }
      }

      this.source = this.audioContext.createMediaElementSource(element);
      this.source.connect(this.analyzer);
      this.analyzer.connect(this.audioContext.destination);
      this.connectedElement = element;
    } catch (err) {
      console.error('Error connecting audio element:', err);
    }
  }

  async connectMicrophone() {
    if (!this.audioContext || !this.analyzer) return;

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.source) {
        this.source.disconnect();
      }
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyzer);
      return stream;
    } catch (err) {
      console.error('Error accessing microphone:', err);
      throw err;
    }
  }

  getFrequencyData(): Uint8Array {
    if (!this.analyzer || !this.dataArray) return new Uint8Array(0);
    this.analyzer.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  getTimeDomainData(): Uint8Array {
    if (!this.analyzer || !this.freqArray) return new Uint8Array(0);
    this.analyzer.getByteTimeDomainData(this.freqArray);
    return this.freqArray;
  }

  setSmoothing(value: number) {
    if (this.analyzer) {
      this.analyzer.smoothingTimeConstant = value;
    }
  }

  getAverageFrequency(): number {
    const data = this.getFrequencyData();
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / data.length;
  }

  /** Divide frequency bins into n equal bands, return normalized energies (0-1) */
  getFrequencyBands(n: number): number[] {
    const data = this.getFrequencyData();
    if (data.length === 0) return new Array(n).fill(0);

    const bands: number[] = [];
    const binSize = Math.floor(data.length / n);

    for (let i = 0; i < n; i++) {
      const start = i * binSize;
      const end = Math.min(start + binSize, data.length);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += data[j];
      }
      bands.push(sum / ((end - start) * 255));
    }
    return bands;
  }

  /** Asymmetric smoothing: fast attack, slow release for punchy club reactivity */
  private asymSmooth(current: number, target: number): number {
    const alpha = target > current ? this.ATTACK_ALPHA : this.RELEASE_ALPHA;
    return current + (target - current) * alpha;
  }

  /** Normalized bass energy (bins 0-10), fast-attack smoothed for kick detection */
  getBassNormalized(): number {
    const data = this.getFrequencyData();
    if (data.length === 0) return 0;
    let sum = 0;
    const end = Math.min(10, data.length);
    for (let i = 0; i < end; i++) sum += data[i];
    const raw = sum / (end * 255);
    this.smoothedBass = this.asymSmooth(this.smoothedBass, raw);
    return this.smoothedBass;
  }

  /** Normalized mid energy (bins 30-100), fast-attack smoothed */
  getMidNormalized(): number {
    const data = this.getFrequencyData();
    if (data.length < 100) return 0;
    let sum = 0;
    for (let i = 30; i < 100; i++) sum += data[i];
    const raw = sum / (70 * 255);
    this.smoothedMid = this.asymSmooth(this.smoothedMid, raw);
    return this.smoothedMid;
  }

  /** Normalized high energy (bins 100-200), fast-attack smoothed */
  getHighNormalized(): number {
    const data = this.getFrequencyData();
    if (data.length < 200) return 0;
    let sum = 0;
    for (let i = 100; i < 200; i++) sum += data[i];
    const raw = sum / (100 * 255);
    this.smoothedHigh = this.asymSmooth(this.smoothedHigh, raw);
    return this.smoothedHigh;
  }

  /** Root Mean Square energy from time domain, fast-attack smoothed (0-1) */
  getRMS(): number {
    const data = this.getTimeDomainData();
    if (data.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const raw = Math.sqrt(sum / data.length);
    this.smoothedRMS = this.asymSmooth(this.smoothedRMS, raw);
    return this.smoothedRMS;
  }

  /** Spectral centroid: weighted average frequency bin, normalized (0-1) */
  getSpectralCentroid(): number {
    const data = this.getFrequencyData();
    if (data.length === 0) return 0;
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < data.length; i++) {
      weightedSum += i * data[i];
      totalWeight += data[i];
    }
    const raw = totalWeight > 0 ? (weightedSum / totalWeight) / data.length : 0;
    this.smoothedCentroid += (raw - this.smoothedCentroid) * this.SMOOTH_ALPHA;
    return this.smoothedCentroid;
  }

  /** Kick detection: returns 0-1 value that spikes on bass transients */
  getKick(): number {
    const data = this.getFrequencyData();
    if (data.length === 0) return 0;

    let bassEnergy = 0;
    const end = Math.min(8, data.length);
    for (let i = 0; i < end; i++) bassEnergy += data[i];
    bassEnergy /= end * 255;

    // Detect transient: energy increase above threshold
    const delta = bassEnergy - this.prevBassEnergy;
    this.prevBassEnergy = bassEnergy;

    if (delta > 0.08) {
      this.kickDecay = Math.min(1, delta * 5);
    }

    // Fast decay for tight kick response
    this.kickDecay *= 0.85;
    return this.kickDecay;
  }

  /** Snare detection: returns 0-1 value that spikes on mid-high transients */
  getSnare(): number {
    const data = this.getFrequencyData();
    if (data.length < 200) return 0;

    let midEnergy = 0;
    for (let i = 50; i < 200; i++) midEnergy += data[i];
    midEnergy /= 150 * 255;

    const delta = midEnergy - this.prevMidEnergy;
    this.prevMidEnergy = midEnergy;

    if (delta > 0.05) {
      this.snareDecay = Math.min(1, delta * 6);
    }

    this.snareDecay *= 0.88;
    return this.snareDecay;
  }

  /** Beat phase 0-1 based on onset detection */
  getBeatPhase(): number {
    const data = this.getFrequencyData();
    if (data.length === 0) return 0;

    let energy = 0;
    const end = Math.min(20, data.length);
    for (let i = 0; i < end; i++) energy += data[i];
    energy /= end;

    this.energyHistory.push(energy);
    if (this.energyHistory.length > 43) this.energyHistory.shift();

    const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    const now = performance.now();

    if (energy > avgEnergy * 1.3 && energy > this.prevEnergy * 1.1 && now - this.lastBeatTime > 200) {
      if (this.lastBeatTime > 0) {
        this.beatInterval = this.beatInterval * 0.7 + (now - this.lastBeatTime) * 0.3;
      }
      this.lastBeatTime = now;
    }
    this.prevEnergy = energy;

    const elapsed = now - this.lastBeatTime;
    this.beatPhase = Math.min(1, elapsed / Math.max(200, this.beatInterval));
    return this.beatPhase;
  }

  /** Estimated BPM based on beat detection */
  getBPM(): number {
    if (this.beatInterval <= 0) return 0;
    return Math.round(60000 / this.beatInterval);
  }

  getAudioStream() {
    if (!this.audioContext || !this.analyzer) return null;
    const destination = this.audioContext.createMediaStreamDestination();
    this.analyzer.connect(destination);
    return destination.stream;
  }

  close() {
    this.audioContext?.close();
  }
}
