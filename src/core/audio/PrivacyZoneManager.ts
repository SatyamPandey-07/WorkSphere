/**
 * PrivacyZoneManager.ts
 * Manages the virtual 3D coordinates of the user and nearby listeners to calculate the required masking intensity.
 * Dynamically adjusts the acoustic privacy mask based on proximity of others.
 * Synthesizes 3D audio cues using WebAudio PannerNode with HRTF panning model,
 * compensating in real-time for device orientation sensor events.
 */

export interface SpatialEntity {
  id: string;
  x: number;
  y: number;
  z: number;
  isTrusted: boolean;
}

export interface EntityAudioChain {
  panner: PannerNode;
  gain: GainNode;
}

export interface SpatialRecalculationBenchmark {
  iterations: number;
  totalDurationMs: number;
  averageLatencyMs: number;
  maxLatencyMs: number;
  withinBudget: boolean;
}

export type BeamPreset = "narrow" | "meeting" | "omnidirectional";

export interface PolarWeights {
  front: number;
  back: number;
  left: number;
  right: number;
}

export interface BeamformingPresetConfig {
  id: BeamPreset;
  name: "Narrow Focus" | "Meeting Mode" | "Ambient Off";
  description: string;
  polarPattern: "cardioid" | "bidirectional" | "omnidirectional";
  polarWeights: PolarWeights;
  filterWeightMatrix: number[][];
  cardioidAlpha: number;
}

export const BEAM_PRESETS: Record<BeamPreset, BeamformingPresetConfig> = {
  narrow: {
    id: "narrow",
    name: "Narrow Focus",
    description: "single speaker cardioid",
    polarPattern: "cardioid",
    polarWeights: {
      front: 1.0,
      back: 0.0,
      left: 0.25,
      right: 0.25,
    },
    filterWeightMatrix: [
      [1.0, 0.0, 0.0, 0.0],
      [0.707, 0.293, 0.0, 0.0],
      [0.25, 0.0, 0.0, 0.25],
      [0.0, 0.0, 0.0, 0.0],
    ],
    cardioidAlpha: 0.5,
  },
  meeting: {
    id: "meeting",
    name: "Meeting Mode",
    description: "bilateral interview",
    polarPattern: "bidirectional",
    polarWeights: {
      front: 1.0,
      back: 1.0,
      left: 0.0,
      right: 0.0,
    },
    filterWeightMatrix: [
      [1.0, 0.0, 0.0, 0.0],
      [0.0, 0.0, 0.0, 0.0],
      [0.0, 0.0, 1.0, 0.0],
      [0.0, 0.0, 0.0, 0.0],
    ],
    cardioidAlpha: 0.0,
  },
  omnidirectional: {
    id: "omnidirectional",
    name: "Ambient Off",
    description: "omnidirectional raw audio",
    polarPattern: "omnidirectional",
    polarWeights: {
      front: 1.0,
      back: 1.0,
      left: 1.0,
      right: 1.0,
    },
    filterWeightMatrix: [
      [0.25, 0.25, 0.25, 0.25],
      [0.25, 0.25, 0.25, 0.25],
      [0.25, 0.25, 0.25, 0.25],
      [0.25, 0.25, 0.25, 0.25],
    ],
    cardioidAlpha: 1.0,
  },
};

export class PrivacyZoneManager {
  private userId: string;
  private entities: Map<string, SpatialEntity>;
  private entityAudioChains: Map<string, EntityAudioChain>;
  private privacyRadius: number; // in meters
  private audioContext: AudioContext | null;
  private isTrackingOrientation: boolean = false;
  private orientationListener:
    ((event: DeviceOrientationEvent) => void) | null = null;
  private listenerForward: { x: number; y: number; z: number } = {
    x: 0,
    y: 0,
    z: -1,
  };
  private listenerUp: { x: number; y: number; z: number } = {
    x: 0,
    y: 1,
    z: 0,
  };
  private listenerPosition: { x: number; y: number; z: number } = {
    x: 0,
    y: 0,
    z: 0,
  };
  private activeBeamPreset: BeamPreset = "omnidirectional";
  private filterWeightMatrix: number[][] = [];

  constructor(
    userId: string,
    privacyRadius: number = 2.0,
    audioContext: AudioContext | null = null,
    initialPreset: BeamPreset = "omnidirectional",
  ) {
    this.userId = userId;
    this.entities = new Map();
    this.entityAudioChains = new Map();
    this.privacyRadius = privacyRadius;
    this.audioContext = audioContext;

    this.setBeamPreset(initialPreset);

    if (typeof window !== "undefined") {
      this.startOrientationTracking();
    }
  }

  public setAudioContext(audioContext: AudioContext): void {
    this.audioContext = audioContext;
    for (const entity of this.entities.values()) {
      this.updateEntitySpatialAudio(entity);
    }
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Sets the active beamforming preset and reconfigures the polar filter weight matrix.
   */
  public setBeamPreset(
    preset: "narrow" | "meeting" | "omnidirectional",
  ): BeamformingPresetConfig {
    const config = BEAM_PRESETS[preset];
    if (!config) {
      throw new Error(
        `Unknown beamforming preset: "${preset}". Valid presets are 'narrow', 'meeting', 'omnidirectional'.`,
      );
    }

    this.activeBeamPreset = preset;
    // Deep clone the filter weight matrix to guarantee isolation
    this.filterWeightMatrix = config.filterWeightMatrix.map((row) => [...row]);
    return config;
  }

  public getBeamPreset(): BeamPreset {
    return this.activeBeamPreset;
  }

  public getBeamPresetConfig(): BeamformingPresetConfig {
    return BEAM_PRESETS[this.activeBeamPreset];
  }

  public getFilterWeightMatrix(): number[][] {
    return this.filterWeightMatrix.map((row) => [...row]);
  }

  public getPolarWeights(): PolarWeights {
    return { ...BEAM_PRESETS[this.activeBeamPreset].polarWeights };
  }

  /**
   * Calculates polar beamforming gain multiplier for an entity at a given azimuth angle.
   */
  public calculateBeamGain(azimuthRad: number): number {
    const config = BEAM_PRESETS[this.activeBeamPreset];
    if (config.polarPattern === "omnidirectional") {
      return 1.0;
    }
    if (config.polarPattern === "bidirectional") {
      return Math.abs(Math.cos(azimuthRad));
    }
    // Cardioid: alpha + (1 - alpha) * cos(theta), clamped to [0, 1]
    return Math.max(
      0.0,
      config.cardioidAlpha +
        (1.0 - config.cardioidAlpha) * Math.cos(azimuthRad),
    );
  }

  /**
   * Creates and configures a WebAudio PannerNode with HRTF panning model and inverse distance attenuation.
   */
  public createPannerNode(_entityId?: string): PannerNode | null {
    if (!this.audioContext) return null;

    let panner: PannerNode;
    if (typeof PannerNode === "function") {
      try {
        panner = new PannerNode(this.audioContext, {
          panningModel: "HRTF",
          distanceModel: "inverse",
          refDistance: 1,
          maxDistance: 100,
          rolloffFactor: 1,
        });
      } catch {
        panner = this.audioContext.createPanner();
        panner.panningModel = "HRTF";
        panner.distanceModel = "inverse";
        panner.refDistance = 1;
        panner.maxDistance = 100;
        panner.rolloffFactor = 1;
      }
    } else {
      panner = this.audioContext.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.maxDistance = 100;
      panner.rolloffFactor = 1;
    }

    return panner;
  }

  private ensureEntityAudioChain(
    entity: SpatialEntity,
  ): EntityAudioChain | null {
    if (!this.audioContext) return null;

    let chain = this.entityAudioChains.get(entity.id);
    if (!chain) {
      const panner = this.createPannerNode(entity.id);
      if (!panner) return null;

      const gain = this.audioContext.createGain();
      panner.connect(gain);
      try {
        if (this.audioContext.destination) {
          gain.connect(this.audioContext.destination);
        }
      } catch {
        // In mock environments, destination may not be fully connected
      }

      chain = { panner, gain };
      this.entityAudioChains.set(entity.id, chain);
    }

    return chain;
  }

  public updateEntitySpatialAudio(entity: SpatialEntity): void {
    const chain = this.ensureEntityAudioChain(entity);
    if (!chain) return;

    const { panner } = chain;
    if (panner.positionX) {
      panner.positionX.value = entity.x;
      panner.positionY.value = entity.y;
      panner.positionZ.value = entity.z;
    } else if ((panner as any).setPosition) {
      (panner as any).setPosition(entity.x, entity.y, entity.z);
    }
  }

  public updateEntity(entity: SpatialEntity): void {
    this.entities.set(entity.id, entity);
    this.updateEntitySpatialAudio(entity);
  }

  public removeEntity(entityId: string): void {
    this.entities.delete(entityId);
    const chain = this.entityAudioChains.get(entityId);
    if (chain) {
      try {
        chain.panner.disconnect();
        chain.gain.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.entityAudioChains.delete(entityId);
    }
  }

  public getEntityAudioChain(entityId: string): EntityAudioChain | undefined {
    return this.entityAudioChains.get(entityId);
  }

  public getPannerNode(entityId: string): PannerNode | undefined {
    return this.entityAudioChains.get(entityId)?.panner;
  }

  public getGainNode(entityId: string): GainNode | undefined {
    return this.entityAudioChains.get(entityId)?.gain;
  }

  /**
   * Calculates the required masking intensity based on nearby untrusted entities.
   * Returns a value between 0.0 (no mask needed) and 1.0 (maximum mask).
   */
  public calculateRequiredMasking(userPos: {
    x: number;
    y: number;
    z: number;
  }): number {
    let maxThreatLevel = 0.0;

    for (const entity of this.entities.values()) {
      if (entity.id === this.userId || entity.isTrusted) {
        continue;
      }

      const distance = Math.sqrt(
        Math.pow(entity.x - userPos.x, 2) +
          Math.pow(entity.y - userPos.y, 2) +
          Math.pow(entity.z - userPos.z, 2),
      );

      if (distance < this.privacyRadius) {
        // Threat level increases as distance decreases (inverse square law approximation)
        const threat = 1.0 - distance / this.privacyRadius;
        if (threat > maxThreatLevel) {
          maxThreatLevel = threat;
        }
      }
    }

    return maxThreatLevel;
  }

  public getNearbyUntrustedCount(userPos: {
    x: number;
    y: number;
    z: number;
  }): number {
    let count = 0;
    for (const entity of this.entities.values()) {
      if (entity.id === this.userId || entity.isTrusted) continue;

      const distance = Math.sqrt(
        Math.pow(entity.x - userPos.x, 2) +
          Math.pow(entity.y - userPos.y, 2) +
          Math.pow(entity.z - userPos.z, 2),
      );

      if (distance < this.privacyRadius) {
        count++;
      }
    }
    return count;
  }

  /**
   * Starts listening for DeviceOrientationEvent sensor events on window.
   */
  public startOrientationTracking(): void {
    if (this.isTrackingOrientation || typeof window === "undefined") return;

    this.orientationListener = (event: DeviceOrientationEvent) => {
      this.handleDeviceOrientation(event);
    };

    window.addEventListener(
      "deviceorientation",
      this.orientationListener,
      true,
    );
    this.isTrackingOrientation = true;
  }

  /**
   * Stops listening for DeviceOrientationEvent sensor events on window.
   */
  public stopOrientationTracking(): void {
    if (!this.isTrackingOrientation || typeof window === "undefined") return;

    if (this.orientationListener) {
      window.removeEventListener(
        "deviceorientation",
        this.orientationListener,
        true,
      );
      this.orientationListener = null;
    }
    this.isTrackingOrientation = false;
  }

  public getIsTrackingOrientation(): boolean {
    return this.isTrackingOrientation;
  }

  /**
   * Handles deviceorientation sensor events and translates angles into 3D vectors.
   */
  public handleDeviceOrientation(event: DeviceOrientationEvent): void {
    this.updateOrientationFromAngles(event.alpha, event.beta, event.gamma);
  }

  /**
   * Converts Euler device orientation angles (alpha: yaw, beta: pitch, gamma: roll in degrees)
   * into 3D listener forward and up vectors, compensating in real-time for head/device rotation.
   */
  public updateOrientationFromAngles(
    alpha: number | null | undefined,
    beta: number | null | undefined,
    gamma: number | null | undefined,
  ): {
    forward: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  } {
    const degToRad = Math.PI / 180;
    const a = (alpha ?? 0) * degToRad; // yaw around Z-axis (compass heading)
    const b = (beta ?? 0) * degToRad; // pitch around X-axis
    const g = (gamma ?? 0) * degToRad; // roll around Y-axis

    const ca = Math.cos(a),
      sa = Math.sin(a);
    const cb = Math.cos(b),
      sb = Math.sin(b);
    const cg = Math.cos(g),
      sg = Math.sin(g);

    // Standard W3C DeviceOrientation rotation matrix transformation:
    // Forward vector transformed from initial (0, 0, -1):
    const forwardX = -(ca * sg + sa * sb * cg);
    const forwardY = -(sa * sg - ca * sb * cg);
    const forwardZ = -(cb * cg);

    // Up vector transformed from initial (0, 1, 0):
    const upX = -sa * cb;
    const upY = ca * cb;
    const upZ = sb;

    this.listenerForward = { x: forwardX, y: forwardY, z: forwardZ };
    this.listenerUp = { x: upX, y: upY, z: upZ };

    this.applyListenerOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);

    return {
      forward: this.listenerForward,
      up: this.listenerUp,
    };
  }

  /**
   * Updates WebAudio AudioListener forward and up orientation vectors.
   */
  public applyListenerOrientation(
    forwardX: number,
    forwardY: number,
    forwardZ: number,
    upX: number = 0,
    upY: number = 1,
    upZ: number = 0,
  ): void {
    if (!this.audioContext) return;
    const listener = this.audioContext.listener;

    if ("forwardX" in listener) {
      listener.forwardX.value = forwardX;
      listener.forwardY.value = forwardY;
      listener.forwardZ.value = forwardZ;
      listener.upX.value = upX;
      listener.upY.value = upY;
      listener.upZ.value = upZ;
    } else if ("setOrientation" in listener) {
      (listener as any).setOrientation(
        forwardX,
        forwardY,
        forwardZ,
        upX,
        upY,
        upZ,
      );
    }
  }

  /**
   * Updates AudioListener 3D position coordinates.
   */
  public updateListenerPosition(x: number, y: number, z: number): void {
    this.listenerPosition = { x, y, z };
    if (!this.audioContext) return;
    const listener = this.audioContext.listener;

    if ("positionX" in listener) {
      listener.positionX.value = x;
      listener.positionY.value = y;
      listener.positionZ.value = z;
    } else if ("setPosition" in listener) {
      (listener as any).setPosition(x, y, z);
    }
  }

  public getListenerOrientation(): {
    forward: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  } {
    return {
      forward: { ...this.listenerForward },
      up: { ...this.listenerUp },
    };
  }

  public getListenerPosition(): { x: number; y: number; z: number } {
    return { ...this.listenerPosition };
  }

  /**
   * Executes a full spatial acoustic recalculation pass:
   * - Recalculates distance and masking intensity from nearby untrusted entities
   * - Adjusts entity PannerNode 3D positions and GainNode attenuation levels
   * - Updates listener orientation/position in WebAudio
   * Returns the computed masking intensity level [0.0, 1.0].
   */
  public recalculateSpatialAcoustics(
    userPos: { x: number; y: number; z: number } = this.listenerPosition,
    orientationAngles?: { alpha?: number; beta?: number; gamma?: number },
  ): number {
    this.updateListenerPosition(userPos.x, userPos.y, userPos.z);

    if (orientationAngles) {
      this.updateOrientationFromAngles(
        orientationAngles.alpha,
        orientationAngles.beta,
        orientationAngles.gamma,
      );
    }

    const maskingLevel = this.calculateRequiredMasking(userPos);

    for (const entity of this.entities.values()) {
      this.updateEntitySpatialAudio(entity);
      const chain = this.entityAudioChains.get(entity.id);
      if (chain && this.audioContext) {
        const distance = Math.sqrt(
          Math.pow(entity.x - userPos.x, 2) +
            Math.pow(entity.y - userPos.y, 2) +
            Math.pow(entity.z - userPos.z, 2),
        );
        const attenuation = distance > 0 ? Math.min(1.0, 1.0 / distance) : 1.0;
        const gainValue = entity.isTrusted
          ? 1.0
          : Math.max(0.0, 1.0 - maskingLevel * attenuation);
        if (chain.gain.gain.setValueAtTime) {
          chain.gain.gain.setValueAtTime(
            gainValue,
            this.audioContext.currentTime,
          );
        } else {
          chain.gain.gain.value = gainValue;
        }
      }
    }

    return maskingLevel;
  }

  /**
   * Benchmarks spatial acoustic recalculation latency over a set number of iterations.
   * Ensures spatial recalculation completes within the 10ms real-time audio latency budget.
   */
  public benchmarkSpatialRecalculation(
    userPos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    iterations: number = 100,
  ): SpatialRecalculationBenchmark {
    const perf = typeof performance !== "undefined" ? performance : Date;
    const latencies: number[] = [];
    const startTime = perf.now();

    for (let i = 0; i < iterations; i++) {
      const iterStart = perf.now();
      this.recalculateSpatialAcoustics(userPos, {
        alpha: (i * 3.6) % 360,
        beta: (i * 1.8) % 90,
        gamma: (i * 0.9) % 45,
      });
      const iterEnd = perf.now();
      latencies.push(iterEnd - iterStart);
    }

    const totalDurationMs = perf.now() - startTime;
    const averageLatencyMs = totalDurationMs / iterations;
    const maxLatencyMs = Math.max(...latencies);
    const withinBudget = averageLatencyMs <= 10.0 && maxLatencyMs <= 10.0;

    return {
      iterations,
      totalDurationMs,
      averageLatencyMs,
      maxLatencyMs,
      withinBudget,
    };
  }

  public destroy(): void {
    this.stopOrientationTracking();
    for (const chain of this.entityAudioChains.values()) {
      try {
        chain.panner.disconnect();
        chain.gain.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    this.entityAudioChains.clear();
    this.entities.clear();
  }
}
