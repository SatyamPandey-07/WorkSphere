/**
 * SpatialAudioConvolver.ts
 * High-performance binaural 3D spatial audio convolution engine with HRTF synthesis,
 * Woodworth spherical head ITD/ILD modeling, distance attenuation, and overlap-add block convolution.
 */

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface Orientation3D {
  yaw: number;   // Rotation around Y (degrees, positive = turn right)
  pitch: number; // Rotation around X (degrees, positive = tilt up)
  roll: number;  // Rotation around Z (degrees, positive = tilt right)
}

export interface SphericalCoordinates {
  azimuth: number;   // Degrees [-180, 180], 0 = straight ahead, 90 = right, -90 = left
  elevation: number; // Degrees [-90, 90], 0 = horizontal plane, 90 = zenith, -90 = nadir
  distance: number;  // Distance in meters
}

export interface BinauralImpulseResponse {
  leftIR: Float32Array;
  rightIR: Float32Array;
  sampleRate: number;
}

export interface SpatialAudioOptions {
  sampleRate?: number;
  headRadiusMeters?: number; // Default 0.0875m (human average)
  speedOfSound?: number;     // Default 343 m/s
  refDistance?: number;      // Default 1.0m
  maxDistance?: number;      // Default 50.0m
  rolloffFactor?: number;    // Default 1.0
  airAbsorption?: boolean;   // Enable frequency-dependent distance absorption
  irLengthSamples?: number;  // Length of synthesized HRIR in samples (default 128)
}

export interface RoomAcousticProperties {
  roomDimensions: Vector3D; // Length, Width, Height (meters)
  wallAbsorption: number;   // Coefficient [0, 1], 0 = full reflection, 1 = total absorption
  reflectionCount?: number; // Number of early reflections to compute (default 6)
}

export class SpatialAudioConvolver {
  private readonly sampleRate: number;
  private readonly headRadius: number;
  private readonly speedOfSound: number;
  private readonly refDistance: number;
  private readonly maxDistance: number;
  private readonly rolloffFactor: number;
  private readonly airAbsorptionEnabled: boolean;
  private readonly irLength: number;

  private listenerPos: Vector3D = { x: 0, y: 0, z: 0 };
  private listenerRot: Orientation3D = { yaw: 0, pitch: 0, roll: 0 };
  private emitterPos: Vector3D = { x: 0, y: 0, z: 1 };
  private emitterVelocity: Vector3D = { x: 0, y: 0, z: 0 };
  private listenerVelocity: Vector3D = { x: 0, y: 0, z: 0 };

  // Overlap-Add convolution state buffers
  private leftOverlapBuffer: Float32Array;
  private rightOverlapBuffer: Float32Array;

  // Cached current active IR
  private currentActiveIR: BinauralImpulseResponse | null = null;

  constructor(options: SpatialAudioOptions = {}) {
    this.sampleRate = options.sampleRate ?? 48000;
    this.headRadius = options.headRadiusMeters ?? 0.0875;
    this.speedOfSound = options.speedOfSound ?? 343.0;
    this.refDistance = options.refDistance ?? 1.0;
    this.maxDistance = options.maxDistance ?? 50.0;
    this.rolloffFactor = options.rolloffFactor ?? 1.0;
    this.airAbsorptionEnabled = options.airAbsorption ?? true;
    this.irLength = options.irLengthSamples ?? 128;

    this.leftOverlapBuffer = new Float32Array(this.irLength - 1);
    this.rightOverlapBuffer = new Float32Array(this.irLength - 1);
  }

  // --- Listener and Emitter Positioning ---

  public setListenerPosition(pos: Vector3D): void {
    this.listenerPos = { ...pos };
    this.invalidateIR();
  }

  public setListenerOrientation(rot: Orientation3D): void {
    this.listenerRot = { ...rot };
    this.invalidateIR();
  }

  public setEmitterPosition(pos: Vector3D): void {
    this.emitterPos = { ...pos };
    this.invalidateIR();
  }

  public setEmitterVelocity(vel: Vector3D): void {
    this.emitterVelocity = { ...vel };
  }

  public setListenerVelocity(vel: Vector3D): void {
    this.listenerVelocity = { ...vel };
  }

  public getListenerPosition(): Vector3D {
    return { ...this.listenerPos };
  }

  public getEmitterPosition(): Vector3D {
    return { ...this.emitterPos };
  }

  // --- Coordinate Transformations ---

  /**
   * Computes the listener-centric Cartesian displacement vector,
   * rotated inversely by the listener's yaw, pitch, and roll orientation.
   */
  public getRelativeCartesianPosition(): Vector3D {
    // Translation relative to listener
    const dx = this.emitterPos.x - this.listenerPos.x;
    const dy = this.emitterPos.y - this.listenerPos.y;
    const dz = this.emitterPos.z - this.listenerPos.z;

    // Apply inverse yaw (rotation around Y-axis)
    // Turning head right (+yaw) shifts forward objects to the left (-X)
    const yawRad = (this.listenerRot.yaw * Math.PI) / 180;
    const cosY = Math.cos(yawRad);
    const sinY = Math.sin(yawRad);
    const x1 = dx * cosY - dz * sinY;
    const z1 = dx * sinY + dz * cosY;

    // Apply inverse pitch (rotation around X-axis)
    // Tilting head up (+pitch) shifts forward objects down (-Y)
    const pitchRad = (this.listenerRot.pitch * Math.PI) / 180;
    const cosP = Math.cos(pitchRad);
    const sinP = Math.sin(pitchRad);
    const y2 = dy * cosP - z1 * sinP;
    const z2 = dy * sinP + z1 * cosP;

    // Apply inverse roll (rotation around Z-axis)
    // Tilting head right (+roll) shifts upward objects to the left (-X)
    const rollRad = (this.listenerRot.roll * Math.PI) / 180;
    const cosR = Math.cos(rollRad);
    const sinR = Math.sin(rollRad);
    const x3 = x1 * cosR - y2 * sinR;
    const y3 = x1 * sinR + y2 * cosR;

    return { x: x3, y: y3, z: z2 };
  }

  /**
   * Computes spherical coordinates (azimuth, elevation, distance)
   * from the listener's frame of reference.
   */
  public getSphericalCoordinates(): SphericalCoordinates {
    const rel = this.getRelativeCartesianPosition();
    const distance = Math.sqrt(rel.x * rel.x + rel.y * rel.y + rel.z * rel.z);

    if (distance < 1e-6) {
      return { azimuth: 0, elevation: 0, distance: 0 };
    }

    // Azimuth: angle in horizontal plane (X-Z plane). Z is forward, X is right.
    // 0 = forward (Z > 0), 90 = right (X > 0), -90 = left (X < 0)
    let azimuth = (Math.atan2(rel.x, rel.z) * 180) / Math.PI;

    // Normalize to [-180, 180]
    while (azimuth > 180) azimuth -= 360;
    while (azimuth < -180) azimuth += 360;

    // Elevation: angle above or below horizontal plane [-90, 90]
    const horizontalDist = Math.sqrt(rel.x * rel.x + rel.z * rel.z);
    const elevation = (Math.atan2(rel.y, horizontalDist) * 180) / Math.PI;

    return { azimuth, elevation, distance };
  }

  // --- Psychoacoustic Modeling: ITD & ILD ---

  /**
   * Woodworth-Schlosser spherical head model for Interaural Time Difference (ITD).
   * Calculates time delay in seconds for left and right ears.
   * Returns: { leftDelaySec, rightDelaySec, deltaSec }
   */
  public computeWoodworthITD(azimuthDeg: number): {
    leftDelaySec: number;
    rightDelaySec: number;
    deltaSec: number;
  } {
    const azRad = (azimuthDeg * Math.PI) / 180;
    const absAz = Math.abs(azRad);

    // Standard Woodworth formula: T = (a / c) * (sin(theta) + theta) for |theta| <= pi/2
    const maxTheta = Math.min(absAz, Math.PI / 2);
    const timeDelta = (this.headRadius / this.speedOfSound) * (Math.sin(maxTheta) + maxTheta);

    if (azimuthDeg >= 0) {
      // Sound is on the right: reaches right ear first
      return {
        leftDelaySec: timeDelta,
        rightDelaySec: 0,
        deltaSec: timeDelta,
      };
    } else {
      // Sound is on the left: reaches left ear first
      return {
        leftDelaySec: 0,
        rightDelaySec: timeDelta,
        deltaSec: -timeDelta,
      };
    }
  }

  /**
   * Computes Interaural Level Difference (ILD) spectral attenuation factors.
   * Contralateral ear experiences high-frequency acoustic shadow attenuation.
   */
  public computeILD(azimuthDeg: number): {
    leftGain: number;
    rightGain: number;
    leftHighShelfGain: number;
    rightHighShelfGain: number;
  } {
    // Normalized lateral position [-1, 1], where 1 is full right, -1 is full left
    const lateral = Math.sin((azimuthDeg * Math.PI) / 180);

    // Base gain (energy conservation)
    // Pan law: equal-power gain
    const pan = (lateral + 1) / 2; // [0, 1]
    const leftGain = Math.cos((pan * Math.PI) / 2);
    const rightGain = Math.sin((pan * Math.PI) / 2);

    // Contralateral high-frequency shadow (attenuates frequencies above 2kHz)
    // Head shadow can attenuate up to 12-18 dB for opposite ear
    const shadowFactor = Math.abs(lateral);
    const leftHighShelf = lateral > 0 ? Math.max(0.2, 1.0 - shadowFactor * 0.75) : 1.0;
    const rightHighShelf = lateral < 0 ? Math.max(0.2, 1.0 - shadowFactor * 0.75) : 1.0;

    return {
      leftGain,
      rightGain,
      leftHighShelfGain: leftHighShelf,
      rightHighShelfGain: rightHighShelf,
    };
  }

  // --- Distance Attenuation & Atmospheric Absorption ---

  /**
   * Calculates distance attenuation gain using inverse distance clamping.
   */
  public computeDistanceGain(distance: number): number {
    if (distance <= this.refDistance) {
      return 1.0;
    }
    const clampedDist = Math.min(distance, this.maxDistance);
    const gain =
      this.refDistance /
      (this.refDistance + this.rolloffFactor * (clampedDist - this.refDistance));
    return Math.max(0.001, Math.min(1.0, gain));
  }

  /**
   * Computes Doppler frequency shift factor based on emitter and listener velocities.
   */
  public computeDopplerFactor(): number {
    // World space vector from listener to emitter
    const dx = this.emitterPos.x - this.listenerPos.x;
    const dy = this.emitterPos.y - this.listenerPos.y;
    const dz = this.emitterPos.z - this.listenerPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-4) return 1.0;

    // Unit vector from listener to emitter in world space
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    // Velocity components along line of sight
    const vEmitterRadial =
      this.emitterVelocity.x * nx +
      this.emitterVelocity.y * ny +
      this.emitterVelocity.z * nz;
    const vListenerRadial =
      this.listenerVelocity.x * nx +
      this.listenerVelocity.y * ny +
      this.listenerVelocity.z * nz;

    const denominator = this.speedOfSound + vEmitterRadial;
    if (Math.abs(denominator) < 1e-3) return 1.0;

    const factor = (this.speedOfSound - vListenerRadial) / denominator;
    return Math.max(0.2, Math.min(5.0, factor));
  }

  // --- HRTF Impulse Response Synthesis ---

  /**
   * Synthesizes or retrieves the binaural HRIR (Head-Related Impulse Response) pair
   * for the current spatial geometry.
   */
  public getBinauralImpulseResponse(): BinauralImpulseResponse {
    if (this.currentActiveIR) {
      return this.currentActiveIR;
    }

    const coords = this.getSphericalCoordinates();
    const itd = this.computeWoodworthITD(coords.azimuth);
    const ild = this.computeILD(coords.azimuth);
    const distGain = this.computeDistanceGain(coords.distance);

    const leftIR = new Float32Array(this.irLength);
    const rightIR = new Float32Array(this.irLength);

    const leftDelaySamples = itd.leftDelaySec * this.sampleRate;
    const rightDelaySamples = itd.rightDelaySec * this.sampleRate;

    // Synthesize minimum-phase pinna notch + head diffraction impulse response
    this.synthesizeEarImpulse(
      leftIR,
      leftDelaySamples,
      ild.leftGain * distGain,
      ild.leftHighShelfGain,
      coords.elevation
    );

    this.synthesizeEarImpulse(
      rightIR,
      rightDelaySamples,
      ild.rightGain * distGain,
      ild.rightHighShelfGain,
      coords.elevation
    );

    this.currentActiveIR = {
      leftIR,
      rightIR,
      sampleRate: this.sampleRate,
    };

    return this.currentActiveIR;
  }

  private synthesizeEarImpulse(
    ir: Float32Array,
    delaySamples: number,
    gain: number,
    highShelfGain: number,
    elevationDeg: number
  ): void {
    const intDelay = Math.floor(delaySamples);
    const fracDelay = delaySamples - intDelay;

    // Elevation pinna spectral notch: pinna causes spectral notch between 6kHz - 10kHz depending on elevation
    // Model pinna reflection delay (typically 0.1ms to 0.4ms)
    const pinnaDelaySamples = Math.max(
      2,
      Math.floor((0.0002 + (elevationDeg / 90) * 0.00015) * this.sampleRate)
    );

    for (let i = 0; i < ir.length; i++) {
      let sample = 0;

      // Sinc interpolation for fractional sample delay of direct arrival
      const d1 = i - intDelay - fracDelay;
      if (Math.abs(d1) < 4) {
        sample += this.sinc(d1) * highShelfGain;
      }

      // Secondary pinna reflection with inverted phase (spectral notch)
      const d2 = i - intDelay - pinnaDelaySamples - fracDelay;
      if (Math.abs(d2) < 4) {
        sample -= 0.35 * this.sinc(d2) * highShelfGain;
      }

      // Windowed exponential decay to avoid abrupt truncation
      const envelope = Math.exp(-i / (this.irLength * 0.25));
      ir[i] = sample * envelope * gain;
    }
  }

  private sinc(x: number): number {
    if (Math.abs(x) < 1e-5) return 1.0;
    const px = Math.PI * x;
    return Math.sin(px) / px;
  }

  private invalidateIR(): void {
    this.currentActiveIR = null;
  }

  // --- Fast Overlap-Add Block Convolution ---

  /**
   * Convolves a block of input audio samples with the spatial binaural HRIR.
   * Uses Overlap-Add (OLA) method to preserve continuous audio continuity between consecutive blocks.
   * 
   * @param inputBlock Mono float audio samples for this processing frame
   * @returns Stereo binaural output buffers { left: Float32Array, right: Float32Array }
   */
  public convolveBlock(inputBlock: Float32Array): {
    left: Float32Array;
    right: Float32Array;
  } {
    const ir = this.getBinauralImpulseResponse();
    const blockSize = inputBlock.length;
    const irLen = this.irLength;
    const overlapLen = irLen - 1;

    const outLeft = new Float32Array(blockSize);
    const outRight = new Float32Array(blockSize);

    // Temporary extended buffers for current block convolution: length = blockSize + irLen - 1
    const rawLeft = new Float32Array(blockSize + overlapLen);
    const rawRight = new Float32Array(blockSize + overlapLen);

    // Direct time-domain convolution for the block
    for (let n = 0; n < blockSize; n++) {
      const inVal = inputBlock[n];
      if (Math.abs(inVal) < 1e-9) continue;

      for (let k = 0; k < irLen; k++) {
        rawLeft[n + k] += inVal * ir.leftIR[k];
        rawRight[n + k] += inVal * ir.rightIR[k];
      }
    }

    // Add previous overlap tails and store output
    for (let i = 0; i < blockSize; i++) {
      const prevL = i < this.leftOverlapBuffer.length ? this.leftOverlapBuffer[i] : 0;
      const prevR = i < this.rightOverlapBuffer.length ? this.rightOverlapBuffer[i] : 0;
      outLeft[i] = rawLeft[i] + prevL;
      outRight[i] = rawRight[i] + prevR;
    }

    // Update overlap buffers for next iteration
    for (let j = 0; j < overlapLen; j++) {
      const nextIdx = blockSize + j;
      const carriedL = nextIdx < rawLeft.length ? rawLeft[nextIdx] : 0;
      const carriedR = nextIdx < rawRight.length ? rawRight[nextIdx] : 0;

      // Also account for long tails if blockSize < overlapLen
      const prevResidualL = j + blockSize < this.leftOverlapBuffer.length
        ? this.leftOverlapBuffer[j + blockSize]
        : 0;
      const prevResidualR = j + blockSize < this.rightOverlapBuffer.length
        ? this.rightOverlapBuffer[j + blockSize]
        : 0;

      this.leftOverlapBuffer[j] = carriedL + prevResidualL;
      this.rightOverlapBuffer[j] = carriedR + prevResidualR;
    }

    return { left: outLeft, right: outRight };
  }

  /**
   * Resets the overlap-add delay line state buffers (e.g. on stream pause/seek).
   */
  public resetOverlapBuffers(): void {
    this.leftOverlapBuffer.fill(0);
    this.rightOverlapBuffer.fill(0);
  }

  // --- Room Acoustics & Early Reflections ---

  /**
   * Computes early reflections using the Image Source Method for a rectangular room.
   */
  public computeRoomEarlyReflections(
    room: RoomAcousticProperties
  ): Array<{ position: Vector3D; gain: number; delaySec: number }> {
    const reflections: Array<{ position: Vector3D; gain: number; delaySec: number }> = [];
    const L = room.roomDimensions.x;
    const W = room.roomDimensions.y;
    const H = room.roomDimensions.z;
    const reflectionGain = 1.0 - room.wallAbsorption;

    // 6 primary image sources: +/- X, +/- Y, +/- Z
    const imagePositions: Vector3D[] = [
      { x: -this.emitterPos.x, y: this.emitterPos.y, z: this.emitterPos.z },       // -X wall
      { x: 2 * L - this.emitterPos.x, y: this.emitterPos.y, z: this.emitterPos.z }, // +X wall
      { x: this.emitterPos.x, y: -this.emitterPos.y, z: this.emitterPos.z },       // -Y wall (floor)
      { x: this.emitterPos.x, y: 2 * W - this.emitterPos.y, z: this.emitterPos.z }, // +Y wall (ceiling)
      { x: this.emitterPos.x, y: this.emitterPos.y, z: -this.emitterPos.z },       // -Z wall
      { x: this.emitterPos.x, y: this.emitterPos.y, z: 2 * H - this.emitterPos.z }, // +Z wall
    ];

    const maxCount = room.reflectionCount ?? 6;
    for (let i = 0; i < Math.min(imagePositions.length, maxCount); i++) {
      const pos = imagePositions[i];
      const dx = pos.x - this.listenerPos.x;
      const dy = pos.y - this.listenerPos.y;
      const dz = pos.z - this.listenerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const delaySec = dist / this.speedOfSound;
      const attenuation = this.computeDistanceGain(dist) * reflectionGain;

      reflections.push({
        position: pos,
        gain: attenuation,
        delaySec,
      });
    }

    return reflections;
  }
}
