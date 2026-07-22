/**
 * WebAudio Spatial Audio Router
 *
 * Connects WebRTC MediaStream audio tracks to HRTF PannerNode instances
 * and manages AudioListener 3D positioning for collaborative room seating.
 */

export interface PeerSpatialChain {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  panner: PannerNode;
  peerId: string;
}

export class SpatialAudioRouter {
  private ctx: AudioContext;
  private chains = new Map<string, PeerSpatialChain>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /**
   * Update local AudioListener position in world space.
   */
  updateListenerPosition(x: number, y: number, z: number): void {
    const listener = this.ctx.listener;
    if ("positionX" in listener) {
      listener.positionX.value = x;
      listener.positionY.value = y;
      listener.positionZ.value = z;
    } else if ("setPosition" in listener) {
      (
        listener as unknown as {
          setPosition: (x: number, y: number, z: number) => void;
        }
      ).setPosition(x, y, z);
    }
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
    const listener = this.ctx.listener;
    if ("forwardX" in listener) {
      listener.forwardX.value = forwardX;
      listener.forwardY.value = forwardY;
      listener.forwardZ.value = forwardZ;
      listener.upX.value = upX;
      listener.upY.value = upY;
      listener.upZ.value = upZ;
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
      ).setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);
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
    panner.connect(this.ctx.destination);

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

    if (
      typeof chain.panner.positionX === "object" &&
      chain.panner.positionX !== null &&
      "value" in chain.panner.positionX
    ) {
      chain.panner.positionX.value = x;
      chain.panner.positionY.value = y;
      chain.panner.positionZ.value = z;
    } else if ("setPosition" in chain.panner) {
      (
        chain.panner as unknown as {
          setPosition: (x: number, y: number, z: number) => void;
        }
      ).setPosition(x, y, z);
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

    if (
      typeof chain.panner.orientationX === "object" &&
      chain.panner.orientationX !== null &&
      "value" in chain.panner.orientationX
    ) {
      chain.panner.orientationX.value = ox;
      chain.panner.orientationY.value = oy;
      chain.panner.orientationZ.value = oz;
    } else if ("setOrientation" in chain.panner) {
      (
        chain.panner as unknown as {
          setOrientation: (x: number, y: number, z: number) => void;
        }
      ).setOrientation(ox, oy, oz);
    }
  }

  /**
   * Adjust per-peer gain volume (0 = mute, 1 = max).
   */
  setPeerVolume(peerId: string, volume: number): void {
    const chain = this.chains.get(peerId);
    if (!chain) return;

    const targetVol = Math.max(0, Math.min(2, volume));
    if (chain.gain.gain.setTargetAtTime) {
      chain.gain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.05);
    } else {
      chain.gain.gain.value = targetVol;
    }
  }

  /**
   * Detach and clean up a remote peer's audio graph.
   */
  detachPeer(peerId: string): void {
    const chain = this.chains.get(peerId);
    if (!chain) return;

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
