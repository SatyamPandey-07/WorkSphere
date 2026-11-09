/**
 * WebAudio Spatial Audio Router
 *
 * Connects WebRTC MediaStream audio tracks to HRTF PannerNode instances
 * and manages AudioListener 3D positioning for collaborative room seating.
 */

import {
  ProximityBoundaryZoneConfig,
  DEFAULT_PROXIMITY_ZONE_CONFIG,
  PROXIMITY_ZONE_PRESETS,
  ProximityZonePresetId,
  calculateProximityFadeGain,
  calculate3DDistance,
  sanitizeProximityZoneConfig,
} from "@/core/audio/ProximityBoundaryZone";

export interface PeerSpatialChain {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  panner: PannerNode;
  peerId: string;
}

export class SpatialAudioRouter {
  private ctx: AudioContext;
  private chains = new Map<string, PeerSpatialChain>();
  private masterGain: GainNode;
  private isMuted: boolean = false;
  private listenerPos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private peerPositions = new Map<string, { x: number; y: number; z: number }>();
  private peerBaseVolumes = new Map<string, number>();
  private proximityZoneConfig: ProximityBoundaryZoneConfig;

  constructor(ctx: AudioContext, proximityZoneConfig?: Partial<ProximityBoundaryZoneConfig>) {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(ctx.destination);
    this.proximityZoneConfig = sanitizeProximityZoneConfig(proximityZoneConfig);
  }

  /**
   * Toggles master audio gain between 0.0 and 1.0.
   */
  toggleMuteAll(): boolean {
    this.isMuted = !this.isMuted;
    const target = this.isMuted ? 0.0 : 1.0;
    if (this.masterGain.gain.setTargetAtTime) {
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    } else {
      this.masterGain.gain.value = target;
    }
    return this.isMuted;
  }

  setMasterGain(gain: number): void {
    const target = Math.max(0, Math.min(1, gain));
    this.isMuted = target === 0;
    if (this.masterGain.gain.setTargetAtTime) {
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    } else {
      this.masterGain.gain.value = target;
    }
  }

  getMasterGain(): number {
    return this.masterGain.gain.value;
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Configures proximity fade-out boundary zones.
   */
  setProximityBoundaryZone(
    config: Partial<ProximityBoundaryZoneConfig>
  ): ProximityBoundaryZoneConfig {
    this.proximityZoneConfig = sanitizeProximityZoneConfig({
      ...this.proximityZoneConfig,
      ...config,
    });
    this.updateAllPeerGains();
    return this.getProximityBoundaryZone();
  }

  getProximityBoundaryZone(): ProximityBoundaryZoneConfig {
    return { ...this.proximityZoneConfig };
  }

  setProximityZonePreset(
    presetId: ProximityZonePresetId
  ): ProximityBoundaryZoneConfig {
    if (presetId in PROXIMITY_ZONE_PRESETS) {
      const preset = PROXIMITY_ZONE_PRESETS[presetId as keyof typeof PROXIMITY_ZONE_PRESETS];
      return this.setProximityBoundaryZone(preset);
    }
    return this.getProximityBoundaryZone();
  }

  calculatePeerEffectiveGain(peerId: string): number {
    const baseVol = this.peerBaseVolumes.get(peerId) ?? 1.0;
    const peerPos = this.peerPositions.get(peerId);
    if (!peerPos || !this.proximityZoneConfig.enabled) {
      return baseVol;
    }
    const dist = calculate3DDistance(peerPos, this.listenerPos);
    const proximityGain = calculateProximityFadeGain(dist, this.proximityZoneConfig);
    return Math.max(0, Math.min(2, baseVol * proximityGain));
  }

  updateAllPeerGains(): void {
    for (const [peerId, chain] of this.chains.entries()) {
      const effectiveGain = this.calculatePeerEffectiveGain(peerId);
      if (chain.gain.gain.setTargetAtTime) {
        chain.gain.gain.setTargetAtTime(effectiveGain, this.ctx.currentTime, 0.05);
      } else {
        chain.gain.gain.value = effectiveGain;
      }
    }
  }

  /**
   * Update local AudioListener position in world space.
   */
  updateListenerPosition(x: number, y: number, z: number): void {
    const clampPos = (v: number) =>
      Math.max(
        -100,
        Math.min(100, Number.isNaN(v) || !Number.isFinite(v) ? 0 : v),
      );
    const cx = clampPos(x);
    const cy = clampPos(y);
    const cz = clampPos(z);
    this.listenerPos = { x: cx, y: cy, z: cz };

    const listener = this.ctx.listener;
    if ("positionX" in listener) {
      listener.positionX.value = cx;
      listener.positionY.value = cy;
      listener.positionZ.value = cz;
    } else if ("setPosition" in listener) {
      (
        listener as unknown as {
          setPosition: (x: number, y: number, z: number) => void;
        }
      ).setPosition(cx, cy, cz);
    }

    this.updateAllPeerGains();
  }

  /**
   * Update local AudioListener orientation (forward and up vectors).
   */
  updateListenerOrientation(
    forwardX: number,
    forwardY: number,
    forwardZ: number,
    upX: number,
    upY: number,
    upZ: number,
  ): void {
    const clampOri = (v: number) =>
      Math.max(-1, Math.min(1, Number.isNaN(v) || !Number.isFinite(v) ? 0 : v));
    const cfx = clampOri(forwardX);
    const cfy = clampOri(forwardY);
    const cfz = clampOri(forwardZ);
    const cux = clampOri(upX);
    const cuy = clampOri(upY);
    const cuz = clampOri(upZ);
    const listener = this.ctx.listener;
    if ("forwardX" in listener) {
      listener.forwardX.value = cfx;
      listener.forwardY.value = cfy;
      listener.forwardZ.value = cfz;
      listener.upX.value = cux;
      listener.upY.value = cuy;
      listener.upZ.value = cuz;
    } else if ("setOrientation" in listener) {
      (
        listener as unknown as {
          setOrientation: (
            fx: number,
            fy: number,
            fz: number,
            ux: number,
            uy: number,
            uz: number,
          ) => void;
        }
      ).setOrientation(cfx, cfy, cfz, cux, cuy, cuz);
    }
  }

  /**
   * Attach a remote WebRTC MediaStream to a PannerNode HRTF spatial chain.
   */
  attachRemoteTrack(peerId: string, stream: MediaStream): PeerSpatialChain {
    this.detachPeer(peerId);

    const source = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;

    this.peerBaseVolumes.set(peerId, 1.0);
    this.peerPositions.set(peerId, { x: 0, y: 2, z: 0 });
    const initialGain = this.calculatePeerEffectiveGain(peerId);
    gain.gain.value = initialGain;

    const panner = new PannerNode(this.ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: 1.0,
      maxDistance: 50.0,
      rolloffFactor: 1.0,
      positionX: 0,
      positionY: 2,
      positionZ: 0,
      orientationX: 0,
      orientationY: 0,
      orientationZ: -1,
      coneInnerAngle: 360,
      coneOuterAngle: 0,
      coneOuterGain: 0,
    });

    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);

    const chain: PeerSpatialChain = { source, gain, panner, peerId };
    this.chains.set(peerId, chain);

    return chain;
  }

  /**
   * Update a peer's 3D position in world space.
   */
  updatePeerPosition(peerId: string, x: number, y: number, z: number): void {
    const chain = this.chains.get(peerId);
    if (!chain) return;

    const clampPos = (v: number) =>
      Math.max(
        -100,
        Math.min(100, Number.isNaN(v) || !Number.isFinite(v) ? 0 : v),
      );
    const cx = clampPos(x);
    const cy = clampPos(y);
    const cz = clampPos(z);
    this.peerPositions.set(peerId, { x: cx, y: cy, z: cz });

    if (
      typeof chain.panner.positionX === "object" &&
      chain.panner.positionX !== null &&
      "value" in chain.panner.positionX
    ) {
      chain.panner.positionX.value = cx;
      chain.panner.positionY.value = cy;
      chain.panner.positionZ.value = cz;
    } else if ("setPosition" in chain.panner) {
      (
        chain.panner as unknown as {
          setPosition: (x: number, y: number, z: number) => void;
        }
      ).setPosition(cx, cy, cz);
    }

    const effectiveGain = this.calculatePeerEffectiveGain(peerId);
    if (chain.gain.gain.setTargetAtTime) {
      chain.gain.gain.setTargetAtTime(effectiveGain, this.ctx.currentTime, 0.05);
    } else {
      chain.gain.gain.value = effectiveGain;
    }
  }

  /**
   * Update a peer's 3D orientation vector.
   */
  updatePeerOrientation(
    peerId: string,
    ox: number,
    oy: number,
    oz: number,
  ): void {
    const chain = this.chains.get(peerId);
    if (!chain) return;

    const clampOri = (v: number) =>
      Math.max(-1, Math.min(1, Number.isNaN(v) || !Number.isFinite(v) ? 0 : v));
    const cox = clampOri(ox);
    const coy = clampOri(oy);
    const coz = clampOri(oz);

    if (
      typeof chain.panner.orientationX === "object" &&
      chain.panner.orientationX !== null &&
      "value" in chain.panner.orientationX
    ) {
      chain.panner.orientationX.value = cox;
      chain.panner.orientationY.value = coy;
      chain.panner.orientationZ.value = coz;
    } else if ("setOrientation" in chain.panner) {
      (
        chain.panner as unknown as {
          setOrientation: (x: number, y: number, z: number) => void;
        }
      ).setOrientation(cox, coy, coz);
    }
  }

  /**
   * Adjust per-peer gain volume (0 = mute, 1 = max).
   */
  setPeerVolume(peerId: string, volume: number): void {
    const chain = this.chains.get(peerId);
    if (!chain) return;

    const targetVol = Math.max(0, Math.min(2, volume));
    this.peerBaseVolumes.set(peerId, targetVol);
    const effectiveGain = this.calculatePeerEffectiveGain(peerId);
    if (chain.gain.gain.setTargetAtTime) {
      chain.gain.gain.setTargetAtTime(effectiveGain, this.ctx.currentTime, 0.05);
    } else {
      chain.gain.gain.value = effectiveGain;
    }
  }

  /**
   * Detach and clean up a remote peer's audio graph.
   */
  detachPeer(peerId: string): void {
    const chain = this.chains.get(peerId);
    if (!chain) return;

    this.peerPositions.delete(peerId);
    this.peerBaseVolumes.delete(peerId);

    try {
      chain.source.disconnect();
    } catch {}
    try {
      chain.gain.disconnect();
    } catch {}
    try {
      chain.panner.disconnect();
    } catch {}

    this.chains.delete(peerId);
  }

  /**
   * Detach all active peer spatial audio chains.
   */
  detachAll(): void {
    for (const peerId of Array.from(this.chains.keys())) {
      this.detachPeer(peerId);
    }
  }

  getChain(peerId: string): PeerSpatialChain | undefined {
    return this.chains.get(peerId);
  }

  getChains(): Map<string, PeerSpatialChain> {
    return this.chains;
  }
}
