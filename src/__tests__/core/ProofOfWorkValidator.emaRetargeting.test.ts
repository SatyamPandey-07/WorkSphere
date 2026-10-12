import {
    ProofOfWorkValidator,
    DEFAULT_DIFFICULTY_CONFIG,
} from '@/core/ledger/ProofOfWorkValidator';

describe('ProofOfWorkValidator per-block EMA retargeting (#5776)', () => {
    describe('calculateEmaBlockTime', () => {
        it('returns 0 when fewer than 2 timestamps are provided', () => {
            expect(ProofOfWorkValidator.calculateEmaBlockTime([]).emaBlockTimeMs).toBe(0);
            expect(ProofOfWorkValidator.calculateEmaBlockTime([1000]).emaBlockTimeMs).toBe(0);
        });

        it('calculates the EMA across consecutive block intervals', () => {
            // Intervals: 10s, 10s, 10s
            const timestamps = [10000, 20000, 30000, 40000];
            const result = ProofOfWorkValidator.calculateEmaBlockTime(timestamps, 12);
            expect(result.emaBlockTimeMs).toBe(10000);
            expect(result.intervals).toEqual([10000, 10000, 10000]);
        });

        it('restricts rolling window to the configured windowSize (default 12 blocks)', () => {
            const base = 100000;
            const timestamps: number[] = [];
            // Generate 20 timestamps with 5s intervals
            for (let i = 0; i < 20; i++) {
                timestamps.push(base + i * 5000);
            }
            const result = ProofOfWorkValidator.calculateEmaBlockTime(timestamps, 12);
            expect(result.intervals.length).toBe(12);
            expect(result.emaBlockTimeMs).toBe(5000);
        });

        it('guards against inverted timestamps and zero intervals by clamping to 1ms', () => {
            // Unsorted / identical timestamps
            const timings = [50000, 50000, 50010];
            const result = ProofOfWorkValidator.calculateEmaBlockTime(timings, 12);
            expect(result.intervals[0]).toBeGreaterThanOrEqual(1);
            expect(result.intervals[1]).toBe(10);
        });
    });

    describe('recalculateEmaDifficulty', () => {
        const targetBlockTimeMs = 10000; // 10 seconds

        it('dampens fast-block difficulty spikes to a maximum of +16%', () => {
            // Submissions arriving in 2 seconds (5x faster than 10s target, raw shift +400%)
            const baseTime = 1000000;
            const fastTimings = [
                baseTime,
                baseTime + 2000,
                baseTime + 4000,
                baseTime + 6000,
            ];

            const result = ProofOfWorkValidator.recalculateEmaDifficulty(2.0, fastTimings, {
                targetBlockTimeMs,
                maxShiftFactor: 0.16,
            });

            expect(result.rawShiftPercent).toBeGreaterThan(16);
            expect(result.clampedShiftPercent).toBe(16);
            expect(result.shiftMultiplier).toBe(1.16);
            // 2.0 * 1.16 = 2.32
            expect(result.newDifficulty).toBe(2.32);
            expect(result.isAdjusted).toBe(true);
        });

        it('dampens slow-block difficulty drops to a maximum of -16%', () => {
            // Submissions arriving in 50 seconds (5x slower than 10s target, raw shift -80%)
            const baseTime = 1000000;
            const slowTimings = [
                baseTime,
                baseTime + 50000,
                baseTime + 100000,
            ];

            const result = ProofOfWorkValidator.recalculateEmaDifficulty(3.0, slowTimings, {
                targetBlockTimeMs,
                maxShiftFactor: 0.16,
            });

            expect(result.rawShiftPercent).toBeLessThan(-16);
            expect(result.clampedShiftPercent).toBe(-16);
            expect(result.shiftMultiplier).toBe(0.84);
            // 3.0 * 0.84 = 2.52
            expect(result.newDifficulty).toBe(2.52);
            expect(result.isAdjusted).toBe(true);
        });

        it('keeps difficulty stable when blocks arrive exactly on target', () => {
            const baseTime = 1000000;
            const onTargetTimings = [
                baseTime,
                baseTime + 10000,
                baseTime + 20000,
                baseTime + 30000,
            ];

            const result = ProofOfWorkValidator.recalculateEmaDifficulty(4.0, onTargetTimings, {
                targetBlockTimeMs,
                maxShiftFactor: 0.16,
            });

            expect(result.rawShiftPercent).toBe(0);
            expect(result.clampedShiftPercent).toBe(0);
            expect(result.shiftMultiplier).toBe(1.0);
            expect(result.newDifficulty).toBe(4.0);
            expect(result.isAdjusted).toBe(false);
        });

        it('strictly respects minDifficulty and maxDifficulty boundaries', () => {
            const baseTime = 1000000;
            const fastTimings = [baseTime, baseTime + 1000, baseTime + 2000];

            const maxResult = ProofOfWorkValidator.recalculateEmaDifficulty(8.0, fastTimings, {
                targetBlockTimeMs,
                maxDifficulty: 8.0,
            });
            expect(maxResult.newDifficulty).toBe(8.0);

            const slowTimings = [baseTime, baseTime + 100000];
            const minResult = ProofOfWorkValidator.recalculateEmaDifficulty(1.0, slowTimings, {
                targetBlockTimeMs,
                minDifficulty: 1.0,
            });
            expect(minResult.newDifficulty).toBe(1.0);
        });
    });

    describe('recordBlock per-block continuous adaptation', () => {
        it('smoothly adapts difficulty on every block across variable intervals without sudden spikes', () => {
            const validator = new ProofOfWorkValidator(3600000, 2.0, {
                targetBlockTimeMs: 10000,
                usePerBlockRetargeting: true,
                retargetWindowSize: 12,
                maxShiftFactor: 0.16,
            });

            let currentTime = 1000000;
            validator.recordBlock(currentTime);

            // Phase 1: Sudden rapid surge (2-second blocks) for 6 blocks
            const recordedDifficulties: number[] = [2.0];
            for (let i = 0; i < 6; i++) {
                currentTime += 2000;
                const newDiff = validator.recordBlock(currentTime);
                recordedDifficulties.push(newDiff);
            }

            // Verify each successive difficulty increase was capped at <= 16%
            for (let i = 1; i < recordedDifficulties.length; i++) {
                const prev = recordedDifficulties[i - 1];
                const curr = recordedDifficulties[i];
                const increaseRatio = curr / prev;
                expect(increaseRatio).toBeLessThanOrEqual(1.1601);
                expect(curr).toBeGreaterThan(prev);
            }

            // Phase 2: Network lull (25-second blocks) for 6 blocks
            const lullDifficulties: number[] = [validator.getDifficulty()];
            for (let i = 0; i < 6; i++) {
                currentTime += 25000;
                const newDiff = validator.recordBlock(currentTime);
                lullDifficulties.push(newDiff);
            }

            // Verify each successive difficulty decrease was capped at <= 16%
            for (let i = 1; i < lullDifficulties.length; i++) {
                const prev = lullDifficulties[i - 1];
                const curr = lullDifficulties[i];
                const decreaseRatio = curr / prev;
                expect(decreaseRatio).toBeGreaterThanOrEqual(0.8399);
                expect(curr).toBeLessThan(prev);
            }
        });

        it('provides integer difficulty helper for leading zero validation', () => {
            const validator = new ProofOfWorkValidator(3600000, 2.32);
            expect(validator.getIntegerDifficulty()).toBe(2);

            validator.setDifficulty(3.7);
            expect(validator.getIntegerDifficulty()).toBe(4);
        });
    });

    describe('recalculateEmaTargetBits compact bits adaptation', () => {
        it('adjusts target bits with 16% single-block shift dampening', () => {
            const genesisBits = 0x1d00ffff;
            const baseTime = 1000000;
            const fastTimings = [baseTime, baseTime + 2000, baseTime + 4000];

            const result = ProofOfWorkValidator.recalculateEmaTargetBits(genesisBits, fastTimings, {
                targetBlockTimeMs: 10000,
                maxShiftFactor: 0.16,
            });

            expect(result.shiftMultiplier).toBe(0.84); // Target drops by 16% when blocks are fast
            expect(result.newTarget < result.currentTarget).toBe(true);
            expect(result.newBits).not.toBe(0);
        });
    });
});
