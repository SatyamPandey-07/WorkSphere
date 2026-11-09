/**
 * ble-proximity.ts
 * Utility to asynchronously load the WASM spatial module and manage memory for signal arrays.
 * Provides a clean Promise-based API for the main thread to communicate with the BLE worker.
 */

export interface FilteredBeaconData {
    beaconId: string;
    smoothedX: number;
    smoothedY: number;
    confidence: number;
}

export const MIN_RSSI_DBM = -120;
export const MAX_RSSI_DBM = -10;
export const DEFAULT_IMMEDIATE_RSSI = -65;
export const DEFAULT_NEAR_RSSI = -85;
export const DEFAULT_FAR_RSSI = -100;

export type ProximityZone = 'immediate' | 'near' | 'far' | 'unknown';

export interface ProximityThresholds {
    immediate: number;
    near: number;
    far?: number;
}

/**
 * Validates and clamps an RSSI threshold to the valid range [-120, -10] dBm.
 * Logs a warning if the value falls outside the range or is invalid.
 */
export function clampRssiThreshold(rssi: number, fallback: number = DEFAULT_IMMEDIATE_RSSI): number {
    if (typeof rssi !== 'number' || isNaN(rssi)) {
        console.warn(`[BLEProximity] Invalid RSSI threshold: ${rssi}. Using fallback ${fallback} dBm.`);
        return fallback;
    }

    if (rssi > MAX_RSSI_DBM) {
        console.warn(`[BLEProximity] RSSI threshold ${rssi} dBm exceeds maximum ${MAX_RSSI_DBM} dBm. Clamping to ${MAX_RSSI_DBM} dBm.`);
        return MAX_RSSI_DBM;
    }

    if (rssi < MIN_RSSI_DBM) {
        console.warn(`[BLEProximity] RSSI threshold ${rssi} dBm below minimum ${MIN_RSSI_DBM} dBm. Clamping to ${MIN_RSSI_DBM} dBm.`);
        return MIN_RSSI_DBM;
    }

    return rssi;
}

/**
 * Validates and normalizes proximity thresholds ensuring immediate zone > near zone.
 */
export function validateProximityThresholds(thresholds?: Partial<ProximityThresholds>): ProximityThresholds {
    const rawImmediate = thresholds?.immediate ?? DEFAULT_IMMEDIATE_RSSI;
    const rawNear = thresholds?.near ?? DEFAULT_NEAR_RSSI;
    const rawFar = thresholds?.far ?? DEFAULT_FAR_RSSI;

    let immediate = clampRssiThreshold(rawImmediate, DEFAULT_IMMEDIATE_RSSI);
    let near = clampRssiThreshold(rawNear, DEFAULT_NEAR_RSSI);
    const far = clampRssiThreshold(rawFar, DEFAULT_FAR_RSSI);

    if (immediate < near) {
        console.warn(
            `[BLEProximity] Immediate threshold (${immediate} dBm) cannot be weaker than near threshold (${near} dBm). Swapping to avoid inverted zones.`
        );
        const temp = immediate;
        immediate = near;
        near = temp;
    }

    return {
        immediate,
        near,
        far,
    };
}

export class BLEProximityWasmLoader {
    private wasmInstance: WebAssembly.Instance | null = null;
    private wasmMemory: WebAssembly.Memory | null = null;
    private isReady: boolean = false;
    private resolveReady: (() => void) | null = null;
    private readyPromise: Promise<void>;
    private thresholds: ProximityThresholds = {
        immediate: DEFAULT_IMMEDIATE_RSSI,
        near: DEFAULT_NEAR_RSSI,
        far: DEFAULT_FAR_RSSI,
    };

    constructor() {
        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });
    }

    public setThresholds(thresholds?: Partial<ProximityThresholds>): ProximityThresholds {
        this.thresholds = validateProximityThresholds(thresholds);
        return this.thresholds;
    }

    public getThresholds(): ProximityThresholds {
        return { ...this.thresholds };
    }

    public getProximityZone(rssi: number): ProximityZone {
        const clampedRssi = clampRssiThreshold(rssi, this.thresholds.far ?? DEFAULT_FAR_RSSI);
        if (clampedRssi >= this.thresholds.immediate) {
            return 'immediate';
        }
        if (clampedRssi >= this.thresholds.near) {
            return 'near';
        }
        if (this.thresholds.far !== undefined && clampedRssi >= this.thresholds.far) {
            return 'far';
        }
        return 'unknown';
    }

    public async initialize(wasmUrl: string = '/wasm/ble_kalman.wasm'): Promise<void> {
        if (typeof WebAssembly === 'undefined') {
            throw new Error('WebAssembly is not supported in this environment.');
        }

        try {
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            const module = await WebAssembly.compile(buffer);

            const importObject = {
                env: {
                    memory: new WebAssembly.Memory({ initial: 16 }),
                }
            };

            this.wasmInstance = await WebAssembly.instantiate(module, importObject);
            this.wasmMemory = importObject.env.memory as WebAssembly.Memory;
            this.isReady = true;

            if (this.resolveReady) this.resolveReady();
        } catch (error) {
            console.error('Failed to initialize BLE Proximity WASM:', error);
            throw error;
        }
    }

    public async getInstance(): Promise<WebAssembly.Instance> {
        await this.readyPromise;
        if (!this.wasmInstance) throw new Error('WASM instance not initialized');
        return this.wasmInstance;
    }

    public async getMemory(): Promise<WebAssembly.Memory> {
        await this.readyPromise;
        if (!this.wasmMemory) throw new Error('WASM memory not initialized');
        return this.wasmMemory;
    }
}

export const bleProximityWasm = new BLEProximityWasmLoader();

