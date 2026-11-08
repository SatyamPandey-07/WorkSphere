/**
 * AvionicsSynthesizer.ts
 *
 * Procedural audio synthesis engine for Hal Jordan fighter jet avionics and Lantern power ring
 * audio effects using the Web Audio API without any audio files.
 *
 * Sound Effects:
 * 1. Turbine Whine (FM Synthesis):
 *    Dual carrier & modulator FM synthesis representing jet turbine compressor spool-up.
 *    Modulation index and carrier frequency scale dynamically with throttle.
 * 2. Supersonic Air Friction Noise:
 *    Pink/Brown noise approximation filtered with a resonant Biquad low-pass filter
 *    mimicking supersonic boundary layer air friction, modulated by velocity.
 * 3. Cockpit RWR Radar Warning Receiver Chirp:
 *    Aviation radar threat warning sweeps and lock tones with fast frequency sweeps (chirps).
 * 4. Sonic Boom Pressure Pulse:
 *    High-amplitude dual-impulse shockwave transient with sub-bass drop and atmospheric attenuation.
 * 5. Lantern Energy Pulse:
 *    Emerald willpower construct resonance featuring multi-oscillator shimmering detune,
 *    exponential ring filter sweep, and harmonic envelope.
 */

export interface FlightTelemetry {
  /** Throttle level from 0.0 (idle) to 1.0 (afterburner / full thrust) */
  throttle: number;
  /** Airspeed in knots (0 to 1200+ knots, supersonic > 660 knots) */
  velocityKnots: number;
  /** Distance to target / observer in meters (10m to 5000m+) */
  distanceMeters: number;
}

export interface AvionicsSynthesizerOptions {
  /** Master volume (0 to 1), defaults to 0.7 */
  masterVolume?: number;
  /** Start in muted state, defaults to false */
  muted?: boolean;
  /** Custom AudioContext factory for testing or dependency injection */
  audioContextFactory?: () => AudioContext | null;
}

export type RadarToneMode = "search" | "track" | "lock";

export class AvionicsSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private readonly audioContextFactory: () => AudioContext | null;

  private isMuted: boolean;
  private masterVolume: number;

  // Active continuous flight sound nodes
  private isEngineRunning: boolean = false;

  // Turbine FM synthesis nodes
  private turbineCarrier: OscillatorNode | null = null;
  private turbineModulator: OscillatorNode | null = null;
  private turbineModGain: GainNode | null = null;
  private turbineGain: GainNode | null = null;

  // Friction noise nodes
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;

  // Distance attenuation node for engine
  private distancePanner: PannerNode | GainNode | null = null;
  private distanceGain: GainNode | null = null;

  // Current telemetry state
  private telemetry: FlightTelemetry = {
    throttle: 0,
    velocityKnots: 0,
    distanceMeters: 50,
  };

  constructor(options: AvionicsSynthesizerOptions = {}) {
    this.masterVolume = Math.max(0, Math.min(1, options.masterVolume ?? 0.7));
    this.isMuted = options.muted ?? false;
    this.audioContextFactory =
      options.audioContextFactory ??
      (() => {
        if (typeof window === "undefined") return null;
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        return Ctor ? new Ctor() : null;
      });
  }

  /**
   * Initializes or returns the existing AudioContext.
   */
  public ensureContext(): AudioContext | null {
    if (this.ctx && this.ctx.state !== "closed") {
      return this.ctx;
    }

    try {
      this.ctx = this.audioContextFactory();
    } catch {
      this.ctx = null;
    }

    if (!this.ctx) return null;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(
      this.isMuted ? 0 : this.masterVolume,
      this.ctx.currentTime,
    );
    this.masterGain.connect(this.ctx.destination);

    return this.ctx;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public getMasterGain(): GainNode | null {
    return this.masterGain;
  }

  public isRunning(): boolean {
    return this.isEngineRunning;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.ctx && this.masterGain && !this.isMuted) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterVolume, now);
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.masterVolume, now);
    }
  }

  /**
   * Starts the continuous procedural flight sound loop (Turbine FM + Supersonic Air Friction).
   */
  public startEngine(initialTelemetry?: Partial<FlightTelemetry>): boolean {
    if (this.isEngineRunning) return true;

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return false;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    if (initialTelemetry) {
      this.telemetry = {
        throttle: initialTelemetry.throttle ?? this.telemetry.throttle,
        velocityKnots: initialTelemetry.velocityKnots ?? this.telemetry.velocityKnots,
        distanceMeters: initialTelemetry.distanceMeters ?? this.telemetry.distanceMeters,
      };
    }

    // 1. Setup Distance Gain Node
    this.distanceGain = ctx.createGain();
    const distGainVal = this.calculateDistanceGain(this.telemetry.distanceMeters);
    this.distanceGain.gain.setValueAtTime(distGainVal, now);
    this.distanceGain.connect(this.masterGain);

    // 2. Setup Turbine FM Synthesis
    // Carrier: High pitched turbine compressor blade blade pass frequency (400Hz - 2400Hz)
    // Modulator: Rotor speed harmonics (80Hz - 450Hz) modulating carrier frequency
    this.turbineCarrier = ctx.createOscillator();
    this.turbineModulator = ctx.createOscillator();
    this.turbineModGain = ctx.createGain();
    this.turbineGain = ctx.createGain();

    this.turbineCarrier.type = "sawtooth";
    this.turbineModulator.type = "sine";

    const carrierFreq = 400 + this.telemetry.throttle * 1600; // 400Hz to 2000Hz
    const modFreq = 80 + this.telemetry.throttle * 320; // 80Hz to 400Hz
    const modDepth = 120 + this.telemetry.throttle * 400; // FM deviation index

    this.turbineCarrier.frequency.setValueAtTime(carrierFreq, now);
    this.turbineModulator.frequency.setValueAtTime(modFreq, now);
    this.turbineModGain.gain.setValueAtTime(modDepth, now);

    this.turbineModulator.connect(this.turbineModGain);
    this.turbineModGain.connect(this.turbineCarrier.frequency);

    const baseTurbineGain = 0.2 + this.telemetry.throttle * 0.4;
    this.turbineGain.gain.setValueAtTime(baseTurbineGain, now);
    this.turbineCarrier.connect(this.turbineGain);
    this.turbineGain.connect(this.distanceGain);

    this.turbineCarrier.start(now);
    this.turbineModulator.start(now);

    // 3. Setup Supersonic Air Friction (Filtered Pink Noise with Resonance)
    const noiseBuffer = this.generatePinkNoiseBuffer(ctx, 3); // 3 seconds looped
    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;

    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "lowpass";

    // Filter frequency and resonance scale with airspeed velocity
    const { cutoff, q, gain } = this.calculateAirFrictionParams(this.telemetry.velocityKnots);
    this.noiseFilter.frequency.setValueAtTime(cutoff, now);
    this.noiseFilter.Q.setValueAtTime(q, now);

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.setValueAtTime(gain, now);

    this.noiseSource.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.distanceGain);

    this.noiseSource.start(now);

    this.isEngineRunning = true;
    return true;
  }

  /**
   * Stops the continuous engine sound loop.
   */
  public stopEngine(): void {
    if (!this.isEngineRunning) return;

    try {
      this.turbineCarrier?.stop();
      this.turbineCarrier?.disconnect();
      this.turbineModulator?.stop();
      this.turbineModulator?.disconnect();
      this.turbineModGain?.disconnect();
      this.turbineGain?.disconnect();

      this.noiseSource?.stop();
      this.noiseSource?.disconnect();
      this.noiseFilter?.disconnect();
      this.noiseGain?.disconnect();
      this.distanceGain?.disconnect();
    } catch {
      // Ignore cleanup error if already stopped
    }

    this.turbineCarrier = null;
    this.turbineModulator = null;
    this.turbineModGain = null;
    this.turbineGain = null;
    this.noiseSource = null;
    this.noiseFilter = null;
    this.noiseGain = null;
    this.distanceGain = null;

    this.isEngineRunning = false;
  }

  /**
   * Modulates flight audio parameters in real time (throttle, velocity, distance).
   * Smoothly ramps AudioParams over rampDuration seconds to prevent audible clicks.
   */
  public updateTelemetry(telemetry: Partial<FlightTelemetry>, rampDuration = 0.05): void {
    if (telemetry.throttle !== undefined) {
      this.telemetry.throttle = Math.max(0, Math.min(1, telemetry.throttle));
    }
    if (telemetry.velocityKnots !== undefined) {
      this.telemetry.velocityKnots = Math.max(0, telemetry.velocityKnots);
    }
    if (telemetry.distanceMeters !== undefined) {
      this.telemetry.distanceMeters = Math.max(0.1, telemetry.distanceMeters);
    }

    if (!this.ctx || !this.isEngineRunning) return;

    const now = this.ctx.currentTime;
    const rampTarget = now + Math.max(0.01, rampDuration);

    // 1. Modulate Turbine FM parameters
    if (this.turbineCarrier && this.turbineModulator && this.turbineModGain && this.turbineGain) {
      const carrierFreq = 400 + this.telemetry.throttle * 1600;
      const modFreq = 80 + this.telemetry.throttle * 320;
      const modDepth = 120 + this.telemetry.throttle * 400;
      const turbineVolume = 0.2 + this.telemetry.throttle * 0.4;

      this.turbineCarrier.frequency.cancelScheduledValues(now);
      this.turbineCarrier.frequency.linearRampToValueAtTime(carrierFreq, rampTarget);

      this.turbineModulator.frequency.cancelScheduledValues(now);
      this.turbineModulator.frequency.linearRampToValueAtTime(modFreq, rampTarget);

      this.turbineModGain.gain.cancelScheduledValues(now);
      this.turbineModGain.gain.linearRampToValueAtTime(modDepth, rampTarget);

      this.turbineGain.gain.cancelScheduledValues(now);
      this.turbineGain.gain.linearRampToValueAtTime(turbineVolume, rampTarget);
    }

    // 2. Modulate Supersonic Air Friction parameters
    if (this.noiseFilter && this.noiseGain) {
      const { cutoff, q, gain } = this.calculateAirFrictionParams(this.telemetry.velocityKnots);

      this.noiseFilter.frequency.cancelScheduledValues(now);
      this.noiseFilter.frequency.linearRampToValueAtTime(cutoff, rampTarget);

      this.noiseFilter.Q.cancelScheduledValues(now);
      this.noiseFilter.Q.linearRampToValueAtTime(q, rampTarget);

      this.noiseGain.gain.cancelScheduledValues(now);
      this.noiseGain.gain.linearRampToValueAtTime(gain, rampTarget);
    }

    // 3. Modulate Distance Attenuation
    if (this.distanceGain) {
      const distGain = this.calculateDistanceGain(this.telemetry.distanceMeters);
      this.distanceGain.gain.cancelScheduledValues(now);
      this.distanceGain.gain.linearRampToValueAtTime(distGain, rampTarget);
    }
  }

  public getTelemetry(): FlightTelemetry {
    return { ...this.telemetry };
  }

  /**
   * Synthesizes a Cockpit Radar Warning Receiver (RWR) chirp.
   * - search: Periodic low chirp (1200Hz to 1600Hz, 80ms)
   * - track: Faster dual chirp (1800Hz to 2400Hz, 60ms)
   * - lock: Urgent continuous rapid sweep / high warble (2500Hz to 3500Hz, 120ms with pulsing)
   */
  public triggerRadarWarning(mode: RadarToneMode = "search"): boolean {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return false;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";

    let duration = 0.08;
    if (mode === "search") {
      // Single chirp sweep
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(1800, now + 0.07);
      duration = 0.08;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    } else if (mode === "track") {
      // Higher dual chirp
      osc.frequency.setValueAtTime(2000, now);
      osc.frequency.linearRampToValueAtTime(2800, now + 0.05);
      duration = 0.06;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.4, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    } else {
      // "lock": Threat missile lock buzzer / critical warble
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(2800, now);
      osc.frequency.linearRampToValueAtTime(3600, now + 0.05);
      osc.frequency.linearRampToValueAtTime(2800, now + 0.1);
      duration = 0.12;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    }

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration + 0.02);

    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };

    return true;
  }

  /**
   * Synthesizes a violent Supersonic Sonic Boom N-wave pressure pulse.
   * Generates twin shockwaves (bow shock and tail shock) followed by deep sub-bass decay.
   */
  public triggerSonicBoom(intensity = 1.0): boolean {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return false;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const clampedIntensity = Math.max(0.1, Math.min(1.0, intensity));
    const now = ctx.currentTime;

    // Sub-bass oscillator for low frequency thunderous pressure pulse
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    const subFilter = ctx.createBiquadFilter();

    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(80, now);
    subOsc.frequency.exponentialRampToValueAtTime(25, now + 1.2);

    subFilter.type = "lowpass";
    subFilter.frequency.setValueAtTime(140, now);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.9 * clampedIntensity, now + 0.015);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

    subOsc.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(this.masterGain);

    subOsc.start(now);
    subOsc.stop(now + 1.5);

    // Shockwave noise transient (crack of bow shock and tail shock)
    const shockBufferSize = Math.floor(ctx.sampleRate * 1.5);
    const shockBuffer = ctx.createBuffer(1, shockBufferSize, ctx.sampleRate);
    const channelData = shockBuffer.getChannelData(0);

    for (let i = 0; i < shockBufferSize; i++) {
      const t = i / ctx.sampleRate;
      // Twin N-wave impulse at t=0 and t=0.1s
      let pulse = 0;
      if (t < 0.08) {
        pulse = (1 - t / 0.08) * (Math.random() * 2 - 1) * 1.5;
      } else if (t >= 0.09 && t < 0.18) {
        pulse = (1 - (t - 0.09) / 0.09) * (Math.random() * 2 - 1) * 1.2;
      } else {
        // Rumbling tail
        pulse = Math.exp(-3 * t) * (Math.random() * 2 - 1) * 0.4;
      }
      channelData[i] = pulse;
    }

    const shockSource = ctx.createBufferSource();
    shockSource.buffer = shockBuffer;

    const shockFilter = ctx.createBiquadFilter();
    shockFilter.type = "lowpass";
    shockFilter.frequency.setValueAtTime(450, now);
    shockFilter.frequency.exponentialRampToValueAtTime(80, now + 1.5);

    const shockGain = ctx.createGain();
    shockGain.gain.setValueAtTime(0.8 * clampedIntensity, now);
    shockGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    shockSource.connect(shockFilter);
    shockFilter.connect(shockGain);
    shockGain.connect(this.masterGain);

    shockSource.start(now);
    shockSource.stop(now + 1.5);

    subOsc.onended = () => {
      subOsc.disconnect();
      subFilter.disconnect();
      subGain.disconnect();
      shockSource.disconnect();
      shockFilter.disconnect();
      shockGain.disconnect();
    };

    return true;
  }

  /**
   * Synthesizes the Green Lantern Power Ring Energy Pulse / Hard-Light Construct Manifestation.
   * High-tech emerald shimmering resonance using multiple detuned sine oscillators
   * and an exponential resonant bandpass filter sweep.
   */
  public triggerLanternPulse(willpowerPower = 1.0): boolean {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return false;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const power = Math.max(0.1, Math.min(1.5, willpowerPower));
    const now = ctx.currentTime;
    const duration = 1.6;

    // Resonant shimmering construct frequencies (fundamental 528Hz "emerald frequency" with 5th and octave)
    const baseFreq = 528;
    const frequencies = [baseFreq, baseFreq * 1.5, baseFreq * 2.0];
    const detunes = [-12, 0, 15]; // cents detune for shimmering hard-light chorusing

    const pulseGain = ctx.createGain();
    pulseGain.gain.setValueAtTime(0.001, now);
    pulseGain.gain.linearRampToValueAtTime(0.6 * Math.min(1, power), now + 0.08);
    pulseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const sweepFilter = ctx.createBiquadFilter();
    sweepFilter.type = "bandpass";
    sweepFilter.Q.setValueAtTime(6.0, now);
    sweepFilter.frequency.setValueAtTime(300, now);
    sweepFilter.frequency.exponentialRampToValueAtTime(3200 * power, now + 0.4);
    sweepFilter.frequency.exponentialRampToValueAtTime(600, now + duration);

    pulseGain.connect(sweepFilter);
    sweepFilter.connect(this.masterGain);

    const oscs: OscillatorNode[] = [];
    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime(detunes[idx], now);
      osc.connect(pulseGain);
      osc.start(now);
      osc.stop(now + duration + 0.05);
      oscs.push(osc);
    });

    if (oscs.length > 0) {
      oscs[0].onended = () => {
        oscs.forEach((o) => o.disconnect());
        pulseGain.disconnect();
        sweepFilter.disconnect();
      };
    }

    return true;
  }

  /**
   * Generates a stereo/mono pink noise buffer using Paul Kellet's filtered white noise algorithm.
   */
  private generatePinkNoiseBuffer(ctx: AudioContext, durationSeconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSeconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      channel[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    return buffer;
  }

  /**
   * Calculates air friction filter parameters based on speed.
   */
  private calculateAirFrictionParams(velocityKnots: number): {
    cutoff: number;
    q: number;
    gain: number;
  } {
    // Air friction is barely audible at 0-100 knots, swells into whistling roar at 400-800 knots
    // and produces high resonance boundary layer hiss supersonic (> 660 knots).
    const normalizedSpeed = Math.min(1.5, velocityKnots / 600); // 1.0 at 600 knots
    const cutoff = Math.min(12000, 300 + normalizedSpeed * 4000);
    const q = 1.0 + Math.min(8.0, normalizedSpeed * 3.5);
    const gain = Math.min(0.7, 0.05 + Math.pow(normalizedSpeed, 1.8) * 0.45);

    return { cutoff, q, gain };
  }

  /**
   * Calculates distance attenuation gain (inverse distance law with minimum clamp).
   */
  private calculateDistanceGain(distanceMeters: number): number {
    const clampedDist = Math.max(10, distanceMeters);
    // Reference distance 50m = 1.0
    return Math.min(1.0, 50 / clampedDist);
  }

  /**
   * Disposes the synthesizer, closing audio context and stopping all nodes.
   */
  public async dispose(): Promise<void> {
    this.stopEngine();

    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }

    if (this.ctx && this.ctx.state !== "closed") {
      try {
        await this.ctx.close();
      } catch {
        // Ignore
      }
      this.ctx = null;
    }
  }
}

export default AvionicsSynthesizer;
