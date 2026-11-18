/**
 * @file BinauralSpatializer.ts
 * @description Real-time Head-Related Transfer Function (HRTF) 3D binaural spatializer for collaborative
 * virtual workspaces, multi-user huddle rooms, and spatial presence engines.
 * Implements Woodworth-Schlosser ITD calculation, head-shadowing ILD filter simulation,
 * distance attenuation models, fractional sub-sample delay lines, and multi-source spatial mixing.
 */

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface ListenerOrientation {
  yaw: number;   // Rotation in degrees around Y-axis (azimuth rotation, + = right)
  pitch: number; // Rotation in degrees around X-axis (elevation rotation, + = look up)
  roll: number;  // Rotation in degrees around Z-axis (+ = tilt right)
}

export interface SpatialCoordinates {
  azimuth: number;   // Degrees [-180, 180], 0 = forward, +90 = right, -90 = left
  elevation: number; // Degrees [-90, 90], 0 = horizontal plane, +90 = zenith, -90 = nadir
  distance: number;  // Distance in meters (>= 0)
}

export interface SpatializerConfig {
  sampleRate?: number;         // Audio sample rate (default: 48000 Hz)
  headRadiusMeters?: number;   // Human head radius in meters (default: 0.0875m)
  speedOfSound?: number;       // Speed of sound in m/s (default: 343.0 m/s)
  referenceDistance?: number;  // Reference distance in meters (default: 1.0m)
  maxDistance?: number;        // Maximum audible distance in meters (default: 50.0m)
  rolloffFactor?: number;      // Distance attenuation rolloff coefficient (default: 1.0)
  distanceModel?: 'inverse' | 'linear' | 'exponential';
  enableAirAbsorption?: boolean;
  smoothingTimeConstant?: number; // Smoothing factor for parameter interpolation [0, 1)
}

export interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
  frameCount: number;
}

export interface SpatialAudioSource {
  id: string;
  position: Vector3;
  gain: number;
  active: boolean;
}

/**
 * High-performance 3D Binaural Spatializer Audio Engine
 */
export class BinauralSpatializer {
  public readonly sampleRate: number;
  public readonly headRadius: number;
  public readonly speedOfSound: number;
  public readonly referenceDistance: number;
  public readonly maxDistance: number;
  public readonly rolloffFactor: number;
  public readonly distanceModel: 'inverse' | 'linear' | 'exponential';
  public readonly enableAirAbsorption: boolean;
  public readonly smoothingTimeConstant: number;

  private listenerPosition: Vector3 = { x: 0, y: 0, z: 0 };
  private listenerOrientation: ListenerOrientation = { yaw: 0, pitch: 0, roll: 0 };

  // Ring buffer delay lines for left and right fractional delays
  private maxDelaySamples: number;
  private delayLineLeft: Float32Array;
  private delayLineRight: Float32Array;
  private writeIndex: number = 0;

  // Smoothing filters for smoothed gains and delays
  private smoothedGainLeft: number = 1.0;
  private smoothedGainRight: number = 1.0;
  private smoothedDelayLeft: number = 0.0;
  private smoothedDelayRight: number = 0.0;

  // Multi-source registry
  private sources: Map<string, SpatialAudioSource> = new Map();

  constructor(config: SpatializerConfig = {}) {
    this.sampleRate = config.sampleRate ?? 48000;
    this.headRadius = config.headRadiusMeters ?? 0.0875;
    this.speedOfSound = config.speedOfSound ?? 343.0;
    this.referenceDistance = config.referenceDistance ?? 1.0;
    this.maxDistance = config.maxDistance ?? 50.0;
    this.rolloffFactor = config.rolloffFactor ?? 1.0;
    this.distanceModel = config.distanceModel ?? 'inverse';
    this.enableAirAbsorption = config.enableAirAbsorption ?? true;
    this.smoothingTimeConstant = config.smoothingTimeConstant ?? 0.85;

    // Maximum head propagation delay + distance margin (~100ms)
    this.maxDelaySamples = Math.ceil(this.sampleRate * 0.1);
    this.delayLineLeft = new Float32Array(this.maxDelaySamples);
    this.delayLineRight = new Float32Array(this.maxDelaySamples);
  }

  // ==========================================
  // Listener and Source Configuration
  // ==========================================

  public setListenerPosition(position: Vector3): void {
    this.listenerPosition = { ...position };
  }

  public getListenerPosition(): Vector3 {
    return { ...this.listenerPosition };
  }

  public setListenerOrientation(orientation: ListenerOrientation): void {
    this.listenerOrientation = { ...orientation };
  }

  public getListenerOrientation(): ListenerOrientation {
    return { ...this.listenerOrientation };
  }

  public registerSource(id: string, position: Vector3, gain: number = 1.0): void {
    this.sources.set(id, { id, position: { ...position }, gain, active: true });
  }

  public updateSourcePosition(id: string, position: Vector3): void {
    const src = this.sources.get(id);
    if (src) {
      src.position = { ...position };
    }
  }

  public removeSource(id: string): boolean {
    return this.sources.delete(id);
  }

  // ==========================================
  // 3D Spherical Coordinate Transformation
  // ==========================================

  /**
   * Computes the relative spherical coordinates (azimuth, elevation, distance)
   * of an emitter with respect to the listener's position and head rotation.
   */
  public calculateRelativeCoordinates(emitterPos: Vector3): SpatialCoordinates {
    // Relative vector from listener to emitter
    const dx = emitterPos.x - this.listenerPosition.x;
    const dy = emitterPos.y - this.listenerPosition.y;
    const dz = emitterPos.z - this.listenerPosition.z;

    // Apply inverse listener yaw rotation around Y-axis
    const yawRad = -(this.listenerOrientation.yaw * Math.PI) / 180;
    const cosY = Math.cos(yawRad);
    const sinY = Math.sin(yawRad);

    const rotX = dx * cosY - dz * sinY;
    const rotZ = dx * sinY + dz * cosY;
    const rotY = dy; // Assume primary head orientation is horizontal yaw

    const distance = Math.sqrt(rotX * rotX + rotY * rotY + rotZ * rotZ);

    if (distance < 1e-6) {
      return { azimuth: 0, elevation: 0, distance: 0 };
    }

    // Azimuth: angle in horizontal plane (X-Z plane). 0 = forward (+Z), +90 = right (+X), -90 = left (-X)
    let azimuthRad = Math.atan2(rotX, rotZ);
    let azimuthDeg = (azimuthRad * 180) / Math.PI;

    // Elevation: angle above/below horizontal plane
    const horizontalDistance = Math.sqrt(rotX * rotX + rotZ * rotZ);
    let elevationRad = Math.atan2(rotY, horizontalDistance);
    let elevationDeg = (elevationRad * 180) / Math.PI;

    return {
      azimuth: azimuthDeg,
      elevation: elevationDeg,
      distance
    };
  }

  // ==========================================
  // Woodworth-Schlosser ITD Modeling
  // ==========================================

  /**
   * Calculates Interaural Time Difference (ITD) in seconds using the Woodworth spherical head model:
   * ITD = (r / c) * (theta + sin(theta)) for theta in [0, pi/2]
   */
  public calculateITD(azimuthDeg: number): { itdSeconds: number; delayLeftSec: number; delayRightSec: number } {
    const thetaRad = Math.abs((azimuthDeg * Math.PI) / 180);
    const r = this.headRadius;
    const c = this.speedOfSound;

    let itdSeconds: number;
    if (thetaRad <= Math.PI / 2) {
      itdSeconds = (r / c) * (thetaRad + Math.sin(thetaRad));
    } else {
      const phi = Math.PI - thetaRad;
      itdSeconds = (r / c) * (Math.PI - phi + Math.sin(phi));
    }

    // Assign ipsilateral and contralateral delays
    let delayLeftSec = 0;
    let delayRightSec = 0;

    if (azimuthDeg > 0) {
      // Sound comes from the right: arrives at right ear first
      delayLeftSec = itdSeconds;
      delayRightSec = 0;
    } else {
      // Sound comes from the left: arrives at left ear first
      delayLeftSec = 0;
      delayRightSec = itdSeconds;
    }

    return { itdSeconds, delayLeftSec, delayRightSec };
  }

  // ==========================================
  // Interaural Level Difference (ILD) & Attenuation
  // ==========================================

  /**
   * Calculates distance attenuation gain factor based on chosen acoustic distance model.
   */
  public calculateDistanceAttenuation(distance: number): number {
    const d = Math.max(distance, this.referenceDistance);

    if (d >= this.maxDistance) {
      return 0.0;
    }

    switch (this.distanceModel) {
      case 'linear': {
        const range = this.maxDistance - this.referenceDistance;
        return Math.max(0, 1 - (this.rolloffFactor * (d - this.referenceDistance)) / range);
      }
      case 'exponential': {
        return Math.pow(d / this.referenceDistance, -this.rolloffFactor);
      }
      case 'inverse':
      default: {
        return this.referenceDistance / (this.referenceDistance + this.rolloffFactor * (d - this.referenceDistance));
      }
    }
  }

  /**
   * Computes ILD gain coefficients for left and right ears, accounting for
   * head-shadowing acoustic baffle effects and distance attenuation.
   */
  public calculateEarGains(azimuthDeg: number, distance: number): { gainLeft: number; gainRight: number } {
    const baseGain = this.calculateDistanceAttenuation(distance);
    if (baseGain <= 0) return { gainLeft: 0, gainRight: 0 };

    // Sine/Cosine pan curve for binaural head shadow factor
    const azimuthRad = (azimuthDeg * Math.PI) / 180;
    const panAngle = (azimuthRad + Math.PI / 2) / 2; // Maps [-180, 180] to [-pi/4, 3pi/4]

    // Head-shadow attenuation factor (up to ~6-8 dB on shadowed ear)
    const sinFactor = Math.sin(azimuthRad); // +1 = full right, -1 = full left
    const shadowDamping = 0.65; // Max attenuation on contralateral side

    let gainLeft = baseGain;
    let gainRight = baseGain;

    if (sinFactor > 0) {
      // Sound from right
      gainRight *= 1.0;
      gainLeft *= 1.0 - shadowDamping * sinFactor;
    } else {
      // Sound from left
      gainLeft *= 1.0;
      gainRight *= 1.0 - shadowDamping * Math.abs(sinFactor);
    }

    // Air absorption damping for high frequencies over distance
    if (this.enableAirAbsorption && distance > 5.0) {
      const airDamping = Math.max(0.7, 1.0 - (distance - 5.0) * 0.005);
      gainLeft *= airDamping;
      gainRight *= airDamping;
    }

    return {
      gainLeft: Math.max(0, gainLeft),
      gainRight: Math.max(0, gainRight)
    };
  }

  // ==========================================
  // Real-Time Buffer Spatialization
  // ==========================================

  /**
   * Spatializes a monophonic audio buffer for a single 3D emitter position,
   * applying fractional delay line interpolation and smoothed binaural gains.
   */
  public spatializeBuffer(monoBuffer: Float32Array, emitterPos: Vector3): StereoBuffer {
    const frameCount = monoBuffer.length;
    const outputLeft = new Float32Array(frameCount);
    const outputRight = new Float32Array(frameCount);

    const coords = this.calculateRelativeCoordinates(emitterPos);
    const { delayLeftSec, delayRightSec } = this.calculateITD(coords.azimuth);
    const { gainLeft: targetGainLeft, gainRight: targetGainRight } = this.calculateEarGains(coords.azimuth, coords.distance);

    const targetDelayLeftSamples = delayLeftSec * this.sampleRate;
    const targetDelayRightSamples = delayRightSec * this.sampleRate;

    const alpha = this.smoothingTimeConstant;

    for (let i = 0; i < frameCount; i++) {
      // Parameter smoothing
      this.smoothedGainLeft = alpha * this.smoothedGainLeft + (1 - alpha) * targetGainLeft;
      this.smoothedGainRight = alpha * this.smoothedGainRight + (1 - alpha) * targetGainRight;
      this.smoothedDelayLeft = alpha * this.smoothedDelayLeft + (1 - alpha) * targetDelayLeftSamples;
      this.smoothedDelayRight = alpha * this.smoothedDelayRight + (1 - alpha) * targetDelayRightSamples;

      const sample = monoBuffer[i];

      // Write to ring buffer
      this.delayLineLeft[this.writeIndex] = sample;
      this.delayLineRight[this.writeIndex] = sample;

      // Read with fractional linear interpolation
      outputLeft[i] = this.readFractionalDelay(this.delayLineLeft, this.writeIndex, this.smoothedDelayLeft) * this.smoothedGainLeft;
      outputRight[i] = this.readFractionalDelay(this.delayLineRight, this.writeIndex, this.smoothedDelayRight) * this.smoothedGainRight;

      this.writeIndex = (this.writeIndex + 1) % this.maxDelaySamples;
    }

    return {
      left: outputLeft,
      right: outputRight,
      frameCount
    };
  }

  /**
   * Read from ring buffer with sub-sample linear interpolation
   */
  private readFractionalDelay(buffer: Float32Array, currentWriteIdx: number, delaySamples: number): number {
    const readPos = currentWriteIdx - delaySamples;
    const wrappedPos = (readPos % this.maxDelaySamples + this.maxDelaySamples) % this.maxDelaySamples;

    const index0 = Math.floor(wrappedPos);
    const index1 = (index0 + 1) % this.maxDelaySamples;
    const frac = wrappedPos - index0;

    return buffer[index0] * (1 - frac) + buffer[index1] * frac;
  }

  /**
   * Mix multiple active spatial sources into a unified stereo buffer
   */
  public mixScene(sourceBuffers: Map<string, Float32Array>): StereoBuffer {
    let maxFrames = 0;
    for (const buf of sourceBuffers.values()) {
      if (buf.length > maxFrames) maxFrames = buf.length;
    }

    const masterLeft = new Float32Array(maxFrames);
    const masterRight = new Float32Array(maxFrames);

    for (const [id, buf] of sourceBuffers.entries()) {
      const src = this.sources.get(id);
      if (!src || !src.active) continue;

      const stereo = this.spatializeBuffer(buf, src.position);
      for (let i = 0; i < stereo.frameCount; i++) {
        masterLeft[i] += stereo.left[i] * src.gain;
        masterRight[i] += stereo.right[i] * src.gain;
      }
    }

    // Soft peak limiting to prevent clipping
    for (let i = 0; i < maxFrames; i++) {
      masterLeft[i] = Math.tanh(masterLeft[i]);
      masterRight[i] = Math.tanh(masterRight[i]);
    }

    return {
      left: masterLeft,
      right: masterRight,
      frameCount: maxFrames
    };
  }
}
