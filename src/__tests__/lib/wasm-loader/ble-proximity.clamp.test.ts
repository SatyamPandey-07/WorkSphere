import {
    clampRssiThreshold,
    validateProximityThresholds,
    BLEProximityWasmLoader,
    MIN_RSSI_DBM,
    MAX_RSSI_DBM,
    DEFAULT_IMMEDIATE_RSSI,
    DEFAULT_NEAR_RSSI,
    DEFAULT_FAR_RSSI,
} from '@/lib/wasm-loader/ble-proximity';

describe('ble-proximity RSSI threshold clamping and validation', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    describe('clampRssiThreshold', () => {
        it('returns values within the valid range [-120, -10] unchanged', () => {
            expect(clampRssiThreshold(-65)).toBe(-65);
            expect(clampRssiThreshold(-85)).toBe(-85);
            expect(clampRssiThreshold(-10)).toBe(-10);
            expect(clampRssiThreshold(-120)).toBe(-120);
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('clamps positive RSSI thresholds to MAX_RSSI_DBM (-10 dBm) and logs a warning', () => {
            expect(clampRssiThreshold(5)).toBe(MAX_RSSI_DBM);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('RSSI threshold 5 dBm exceeds maximum -10 dBm. Clamping to -10 dBm.')
            );
        });

        it('clamps values above -10 dBm (e.g. 0 dBm) to -10 dBm', () => {
            expect(clampRssiThreshold(0)).toBe(-10);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('exceeds maximum -10 dBm')
            );
        });

        it('clamps values below -120 dBm (e.g. -150 dBm) to -120 dBm and logs a warning', () => {
            expect(clampRssiThreshold(-150)).toBe(MIN_RSSI_DBM);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('RSSI threshold -150 dBm below minimum -120 dBm. Clamping to -120 dBm.')
            );
        });

        it('falls back to default when input is NaN or invalid type', () => {
            expect(clampRssiThreshold(NaN)).toBe(DEFAULT_IMMEDIATE_RSSI);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Invalid RSSI threshold: NaN')
            );

            expect(clampRssiThreshold(undefined as unknown as number, -70)).toBe(-70);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Using fallback -70 dBm')
            );
        });
    });

    describe('validateProximityThresholds', () => {
        it('provides default immediate and near thresholds when omitted', () => {
            const thresholds = validateProximityThresholds();
            expect(thresholds.immediate).toBe(DEFAULT_IMMEDIATE_RSSI); // -65
            expect(thresholds.near).toBe(DEFAULT_NEAR_RSSI); // -85
            expect(thresholds.far).toBe(DEFAULT_FAR_RSSI); // -100
        });

        it('clamps custom thresholds if out of bounds', () => {
            const thresholds = validateProximityThresholds({
                immediate: 10, // positive out of bound
                near: -140,    // negative out of bound
            });
            expect(thresholds.immediate).toBe(-10);
            expect(thresholds.near).toBe(-120);
            expect(warnSpy).toHaveBeenCalled();
        });

        it('swaps inverted thresholds to ensure immediate is stronger than near', () => {
            // e.g. immediate = -90, near = -50 (inverted signal strength)
            const thresholds = validateProximityThresholds({
                immediate: -90,
                near: -50,
            });
            expect(thresholds.immediate).toBe(-50);
            expect(thresholds.near).toBe(-90);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Immediate threshold (-90 dBm) cannot be weaker than near threshold (-50 dBm). Swapping to avoid inverted zones.')
            );
        });
    });

    describe('BLEProximityWasmLoader threshold methods', () => {
        it('initializes with default thresholds', () => {
            const loader = new BLEProximityWasmLoader();
            expect(loader.getThresholds()).toEqual({
                immediate: -65,
                near: -85,
                far: -100,
            });
        });

        it('updates thresholds safely using setThresholds', () => {
            const loader = new BLEProximityWasmLoader();
            loader.setThresholds({ immediate: -55, near: -75 });
            expect(loader.getThresholds().immediate).toBe(-55);
            expect(loader.getThresholds().near).toBe(-75);
        });

        it('correctly maps RSSI readings to proximity zones without zone inversion', () => {
            const loader = new BLEProximityWasmLoader();
            // Default thresholds: immediate >= -65, near >= -85, far >= -100
            expect(loader.getProximityZone(-50)).toBe('immediate');
            expect(loader.getProximityZone(-70)).toBe('near');
            expect(loader.getProximityZone(-95)).toBe('far');
            expect(loader.getProximityZone(-110)).toBe('far');

            // Positive RSSI (e.g. +5 dBm) clamps to -10 dBm, which is >= -65 (immediate)
            expect(loader.getProximityZone(5)).toBe('immediate');
        });
    });
});
