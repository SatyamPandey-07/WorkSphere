/**
 * SpatialAudioPanner.ts
 * Manages the Web Audio API PannerNodes and GainNodes, calculating 3D coordinates and distance attenuation 
 * based on desk layouts. Sanitizes and clamps gain coefficients to [0.0, 1.0] to prevent audio clipping (#5597).
 *
 * Distance attenuation is configurable per room. Creators can pick the Web Audio
 * `distanceModel` (`inverse`, `linear`, or `exponential`) and tune `refDistance`,
 * `maxDistance`, and `rolloffFactor` to make remote voices fade sharply (open
 * library) or remain audible across long distances (linear hall) (#6478).
 */

import {
    ProximityBoundaryZoneConfig,
    PROXIMITY_ZONE_PRESETS,
    ProximityZonePresetId,
    calculateProximityFadeGain,
    sanitizeProximityZoneConfig,
} from './ProximityBoundaryZone';

export * from './ProximityBoundaryZone';

export type DistanceAttenuationCurve = 'linear' | 'inverse' | 'exponential';
export type DistanceAttenuationModel = DistanceAttenuationCurve;

export interface SpatialPannerDistanceConfig {
    /** Web Audio distance attenuation model applied to every peer PannerNode. */
    distanceModel?: DistanceAttenuationCurve;
    /** Reference distance (metres) at which no attenuation is applied. */
    refDistance?: number;
    /** Distance (metres) at which the attenuation curve is clamped. */
    maxDistance?: number;
    /** Steepness of the attenuation curve. Higher values fade out faster. */
    rolloffFactor?: number;
}

export type ResolvedSpatialPannerDistanceConfig = Required<SpatialPannerDistanceConfig>;

export const DEFAULT_SPATIAL_PANNER_DISTANCE_CONFIG: ResolvedSpatialPannerDistanceConfig = {
    distanceModel: 'inverse',
    refDistance: 1,
    maxDistance: 100,
    rolloffFactor: 1,
};

/**
 * Physically safe bounds accepted by the Web Audio API. Values outside these
 * ranges can produce silence, deafening gain spikes, or NaN coefficients.
 */
export const SPATIAL_PANNER_DISTANCE_LIMITS = {
    minRefDistance: 1e-3,
    maxRefDistance: 10000,
    minMaxDistance: 1e-3,
    maxMaxDistance: 1000000,
    minRolloffFactor: 0,
    maxRolloffFactor: 10,
} as const;

const DISTANCE_MODELS: readonly DistanceAttenuationCurve[] = ['linear', 'inverse', 'exponential'];

export function isDistanceAttenuationCurve(value: unknown): value is DistanceAttenuationCurve {
    return typeof value === 'string' && (DISTANCE_MODELS as readonly string[]).includes(value);
}

function clampFinite(value: number | undefined, fallback: number, min: number, max: number): number {
    const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, candidate));
}

/**
 * Sanitizes a partial distance configuration into physically safe Web Audio
 * bounds. Invalid/NaN values fall back to the supplied base configuration and
 * `maxDistance` is always kept strictly greater than `refDistance`.
 */
export function sanitizeDistanceConfig(
    partial: Partial<SpatialPannerDistanceConfig> = {},
    base: ResolvedSpatialPannerDistanceConfig = DEFAULT_SPATIAL_PANNER_DISTANCE_CONFIG
): ResolvedSpatialPannerDistanceConfig {
    const {
        minRefDistance,
        maxRefDistance,
        minMaxDistance,
        maxMaxDistance,
        minRolloffFactor,
        maxRolloffFactor,
    } = SPATIAL_PANNER_DISTANCE_LIMITS;

    const distanceModel = isDistanceAttenuationCurve(partial.distanceModel)
        ? partial.distanceModel
        : base.distanceModel;

    const refDistance = clampFinite(partial.refDistance, base.refDistance, minRefDistance, maxRefDistance);

    let maxDistance = clampFinite(partial.maxDistance, base.maxDistance, minMaxDistance, maxMaxDistance);
    if (maxDistance <= refDistance) {
        maxDistance = Math.min(maxMaxDistance, refDistance + Math.max(minMaxDistance, refDistance * 1e-3));
    }

    const rolloffFactor = clampFinite(
        partial.rolloffFactor,
        base.rolloffFactor,
        minRolloffFactor,
        maxRolloffFactor
    );

    return {
        distanceModel,
        refDistance: Number(refDistance.toFixed(4)),
        maxDistance: Number(maxDistance.toFixed(4)),
        rolloffFactor: Number(rolloffFactor.toFixed(4)),
    };
}

export interface SpatialPeer {
    id: string;
    audioStream: MediaStream | null;
    pannerNode: PannerNode | null;
    gainNode: GainNode | null;
    position: { x: number; y: number; z: number };
}

export class SpatialAudioPanner {
    private audioContext: AudioContext;
    private peers: Map<string, SpatialPeer>;
    private listener: AudioListener;
    private listenerPosition: { x: number; y: number; z: number };
    private distanceModel: DistanceAttenuationCurve;
    private proximityZoneConfig: ProximityBoundaryZoneConfig;

    private masterGainNode: GainNode;
    private isMuted: boolean = false;

    private refDistanceValue: number;
    private maxDistanceValue: number;
    private rolloffFactorValue: number;

    public get refDistance(): number {
        return this.refDistanceValue;
    }

    public get maxDistance(): number {
        return this.maxDistanceValue;
    }

    public get rolloffFactor(): number {
        return this.rolloffFactorValue;
    }

    constructor(
        audioContext: AudioContext,
        initialDistanceModel: DistanceAttenuationCurve = 'inverse',
        proximityZoneConfig?: Partial<ProximityBoundaryZoneConfig>,
        distanceConfig?: Partial<SpatialPannerDistanceConfig>
    ) {
        this.audioContext = audioContext;
        this.peers = new Map();
        this.listener = audioContext.listener;
        this.listenerPosition = { x: 0, y: 0, z: 0 };

        const resolvedDistance = sanitizeDistanceConfig({
            distanceModel: distanceConfig?.distanceModel ?? initialDistanceModel,
            refDistance: distanceConfig?.refDistance,
            maxDistance: distanceConfig?.maxDistance,
            rolloffFactor: distanceConfig?.rolloffFactor,
        });
        this.distanceModel = resolvedDistance.distanceModel;
        this.refDistanceValue = resolvedDistance.refDistance;
        this.maxDistanceValue = resolvedDistance.maxDistance;
        this.rolloffFactorValue = resolvedDistance.rolloffFactor;
        this.proximityZoneConfig = sanitizeProximityZoneConfig(proximityZoneConfig);

        // Initialize master listener GainNode routed to destination
        this.masterGainNode = audioContext.createGain();
        this.masterGainNode.gain.setValueAtTime(1.0, audioContext.currentTime);
        this.masterGainNode.connect(audioContext.destination);

        // Set default listener position (center of room)
        if (this.listener.positionX) {
            this.listener.positionX.value = 0;
            this.listener.positionY.value = 0;
            this.listener.positionZ.value = 0;
        }
    }

    /**
     * Toggles mute state of master audio listener GainNode between 0.0 and 1.0.
     * Silences all incoming peer audio streams without destroying peer audio pipelines.
     */
    public toggleMuteAll(): boolean {
        this.isMuted = !this.isMuted;
        const targetGain = this.isMuted ? 0.0 : 1.0;
        this.masterGainNode.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
        return this.isMuted;
    }

    public setMasterGain(gain: number): void {
        const clamped = Math.max(0.0, Math.min(1.0, gain));
        this.isMuted = clamped === 0.0;
        this.masterGainNode.gain.setValueAtTime(clamped, this.audioContext.currentTime);
    }

    public getMasterGain(): number {
        return this.masterGainNode.gain.value;
    }

    public getIsMuted(): boolean {
        return this.isMuted;
    }

    public getDistanceConfig(): ResolvedSpatialPannerDistanceConfig {
        return {
            distanceModel: this.distanceModel,
            refDistance: this.refDistanceValue,
            maxDistance: this.maxDistanceValue,
            rolloffFactor: this.rolloffFactorValue,
        };
    }

    public getDistanceModel(): DistanceAttenuationCurve {
        return this.distanceModel;
    }

    /**
     * Applies a partial distance configuration, clamping every value to
     * physically safe Web Audio bounds, updating all live PannerNodes, and
     * recalculating active peer gains.
     */
    public setDistanceConfig(config: Partial<SpatialPannerDistanceConfig>): ResolvedSpatialPannerDistanceConfig {
        const resolved = sanitizeDistanceConfig(config, this.getDistanceConfig());

        this.distanceModel = resolved.distanceModel;
        this.refDistanceValue = resolved.refDistance;
        this.maxDistanceValue = resolved.maxDistance;
        this.rolloffFactorValue = resolved.rolloffFactor;

        for (const peer of this.peers.values()) {
            if (peer.pannerNode) {
                peer.pannerNode.distanceModel = this.distanceModel;
                peer.pannerNode.refDistance = this.refDistanceValue;
                peer.pannerNode.maxDistance = this.maxDistanceValue;
                peer.pannerNode.rolloffFactor = this.rolloffFactorValue;
            }
        }

        this.recalculateAllPeerAttenuations();
        return this.getDistanceConfig();
    }

    public setDistanceModel(model: DistanceAttenuationCurve): ResolvedSpatialPannerDistanceConfig {
        return this.setDistanceConfig({ distanceModel: model });
    }

    public setRefDistance(refDistance: number): ResolvedSpatialPannerDistanceConfig {
        return this.setDistanceConfig({ refDistance });
    }

    public setMaxDistance(maxDistance: number): ResolvedSpatialPannerDistanceConfig {
        return this.setDistanceConfig({ maxDistance });
    }

    public setRolloffFactor(rolloffFactor: number): ResolvedSpatialPannerDistanceConfig {
        return this.setDistanceConfig({ rolloffFactor });
    }

    /**
     * Updates configurable proximity boundary zone parameters and recalculates active peer gains.
     */
    public setProximityBoundaryZone(config: Partial<ProximityBoundaryZoneConfig>): ProximityBoundaryZoneConfig {
        this.proximityZoneConfig = sanitizeProximityZoneConfig({
            ...this.proximityZoneConfig,
            ...config,
        });
        this.recalculateAllPeerAttenuations();
        return this.getProximityBoundaryZone();
    }

    public getProximityBoundaryZone(): ProximityBoundaryZoneConfig {
        return { ...this.proximityZoneConfig };
    }

    public setProximityZonePreset(presetId: ProximityZonePresetId): ProximityBoundaryZoneConfig {
        if (presetId in PROXIMITY_ZONE_PRESETS) {
            const preset = PROXIMITY_ZONE_PRESETS[presetId as keyof typeof PROXIMITY_ZONE_PRESETS];
            return this.setProximityBoundaryZone(preset);
        }
        return this.getProximityBoundaryZone();
    }

    public recalculateAllPeerAttenuations(): void {
        for (const peer of this.peers.values()) {
            if (peer.gainNode) {
                const clampedGain = this.calculateDistanceAttenuation(peer.position, this.listenerPosition);
                peer.gainNode.gain.setValueAtTime(clampedGain, this.audioContext.currentTime);
            }
        }
    }

    /**
     * Calculates distance attenuation gain clamped strictly between 0.0 and 1.0.
     * Supports 'inverse', 'linear', and 'exponential' Web Audio attenuation
     * curves combined with configurable audio proximity fade-out boundary zones.
     * Guards against negative values and protects against NaN (#5597, #6478).
     */
    public calculateDistanceAttenuation(
        sourcePos: { x: number; y: number; z: number },
        listenerPos: { x: number; y: number; z: number } = this.listenerPosition,
        model: DistanceAttenuationCurve = this.distanceModel
    ): number {
        const dx = (sourcePos.x ?? 0) - (listenerPos.x ?? 0);
        const dy = (sourcePos.y ?? 0) - (listenerPos.y ?? 0);
        const dz = (sourcePos.z ?? 0) - (listenerPos.z ?? 0);

        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Guard against NaN or identical coordinates
        if (Number.isNaN(distance) || !Number.isFinite(distance) || distance <= 0) {
            return 1.0;
        }

        // Web Audio clamps the computed distance to [refDistance, maxDistance]
        // before evaluating the attenuation curve. This keeps inverse and
        // exponential voices audible at the configured horizon instead of
        // collapsing to silence, while linear still fades to zero.
        const clampedDistance = Math.min(Math.max(distance, this.refDistance), this.maxDistance);
        let calculatedGain: number;

        switch (model) {
            case 'linear': {
                // gain = 1 - rolloffFactor * (distance - refDistance) / (maxDistance - refDistance)
                const distanceRange = Math.max(1e-6, this.maxDistance - this.refDistance);
                calculatedGain =
                    1 - this.rolloffFactor * ((clampedDistance - this.refDistance) / distanceRange);
                break;
            }
            case 'exponential': {
                // gain = (distance / refDistance) ^ (-rolloffFactor)
                calculatedGain = Math.pow(clampedDistance / this.refDistance, -this.rolloffFactor);
                break;
            }
            case 'inverse':
            default: {
                // gain = refDistance / (refDistance + rolloffFactor * (distance - refDistance))
                calculatedGain =
                    this.refDistance /
                    (this.refDistance + this.rolloffFactor * (clampedDistance - this.refDistance));
                break;
            }
        }

        // Apply configurable audio proximity fade-out boundary zone
        if (this.proximityZoneConfig && this.proximityZoneConfig.enabled) {
            const proximityFactor = calculateProximityFadeGain(distance, this.proximityZoneConfig);
            calculatedGain = calculatedGain * proximityFactor;
        }

        // Strict clamp to [0.0, 1.0] and NaN check
        if (Number.isNaN(calculatedGain) || !Number.isFinite(calculatedGain)) {
            return 0.0;
        }

        return Math.max(0.0, Math.min(1.0, calculatedGain));
    }

    public addPeer(peerId: string, stream: MediaStream): void {
        if (this.peers.has(peerId)) return;

        const panner = this.audioContext.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = this.distanceModel;
        panner.refDistance = this.refDistance;
        panner.maxDistance = this.maxDistance;
        panner.rolloffFactor = this.rolloffFactor;
        panner.coneInnerAngle = 360;
        panner.coneOuterAngle = 0;
        panner.coneOuterGain = 0;

        const gainNode = this.audioContext.createGain();
        const initialGain = this.calculateDistanceAttenuation({ x: 0, y: 0, z: 0 });
        gainNode.gain.setValueAtTime(initialGain, this.audioContext.currentTime);

        const source = this.audioContext.createMediaStreamSource(stream);
        source.connect(panner);
        panner.connect(gainNode);
        gainNode.connect(this.masterGainNode);

        this.peers.set(peerId, {
            id: peerId,
            audioStream: stream,
            pannerNode: panner,
            gainNode,
            position: { x: 0, y: 0, z: 0 }
        });
    }

    public updatePeerPosition(peerId: string, x: number, y: number, z: number): void {
        const peer = this.peers.get(peerId);
        if (peer && peer.pannerNode) {
            peer.position = { x, y, z };
            if (peer.pannerNode.positionX) {
                peer.pannerNode.positionX.value = x;
                peer.pannerNode.positionY.value = y;
                peer.pannerNode.positionZ.value = z;
            } else {
                peer.pannerNode.setPosition(x, y, z);
            }

            // Update clamped gain
            if (peer.gainNode) {
                const clampedGain = this.calculateDistanceAttenuation(peer.position);
                peer.gainNode.gain.setValueAtTime(clampedGain, this.audioContext.currentTime);
            }
        }
    }

    public updateListenerPosition(x: number, y: number, z: number, forwardX: number, forwardY: number, forwardZ: number): void {
        this.listenerPosition = { x, y, z };

        if (this.listener.positionX) {
            this.listener.positionX.value = x;
            this.listener.positionY.value = y;
            this.listener.positionZ.value = z;
            this.listener.forwardX.value = forwardX;
            this.listener.forwardY.value = forwardY;
            this.listener.forwardZ.value = forwardZ;
            this.listener.upX.value = 0;
            this.listener.upY.value = 1;
            this.listener.upZ.value = 0;
        } else {
            this.listener.setPosition(x, y, z);
            this.listener.setOrientation(forwardX, forwardY, forwardZ, 0, 1, 0);
        }

        // Recalculate distance attenuation for all active peers
        for (const peer of this.peers.values()) {
            if (peer.gainNode) {
                const clampedGain = this.calculateDistanceAttenuation(peer.position, this.listenerPosition);
                peer.gainNode.gain.setValueAtTime(clampedGain, this.audioContext.currentTime);
            }
        }
    }

    public removePeer(peerId: string): void {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.pannerNode?.disconnect();
            peer.gainNode?.disconnect();
            this.peers.delete(peerId);
        }
    }

    public destroy(): void {
        for (const peer of this.peers.values()) {
            peer.pannerNode?.disconnect();
            peer.gainNode?.disconnect();
        }
        this.peers.clear();
        try {
            this.masterGainNode.disconnect();
        } catch {
            // Ignore disconnect error
        }
    }
}
