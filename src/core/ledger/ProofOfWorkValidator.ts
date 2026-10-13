/**
 * ProofOfWorkValidator.ts
 * Validates the cryptographic effort required to submit venue data, preventing spam and bot submissions.
 * Ensures the client has expended CPU cycles to find a valid nonce for the Merkle root.
 */

import { createHash } from 'crypto';

export interface PoWSubmission {
    merkleRoot: string;
    nonce: string;
    difficulty: number; // Number of leading zeros required
    timestamp: number;
}

export interface BlockTimingInfo {
    blockHeight?: number;
    timestamp: number;
}

export interface DifficultyAdjustmentConfig {
    targetBlockTimeMs: number; // Expected milliseconds per block/submission
    retargetInterval: number; // Number of blocks per retarget epoch
    minDifficulty: number; // Minimum leading zeros
    maxDifficulty: number; // Maximum leading zeros
    maxAdjustmentFactor: number; // Max dampening factor to prevent oscillation (e.g. 4)
    retargetWindowSize?: number; // Number of past blocks used for per-block EMA retargeting (default 12)
    maxShiftFactor?: number; // Maximum single-block difficulty shift (default 0.16 for +/- 16%)
    usePerBlockRetargeting?: boolean; // When true, updates difficulty per block (default true)
}

export interface DifficultyRecalculationResult {
    newDifficulty: number;
    currentDifficulty: number;
    actualTimeMs: number;
    expectedTimeMs: number;
    adjustmentRatio: number;
    isAdjusted: boolean;
}

export interface EmaRetargetingResult {
    newDifficulty: number;
    currentDifficulty: number;
    emaBlockTimeMs: number;
    targetBlockTimeMs: number;
    rawShiftPercent: number;
    clampedShiftPercent: number;
    shiftMultiplier: number;
    isAdjusted: boolean;
    sampleCount: number;
}

export interface CompactBitsRetargetingResult {
    newBits: number;
    currentBits: number;
    newTarget: bigint;
    currentTarget: bigint;
    emaBlockTimeMs: number;
    targetBlockTimeMs: number;
    shiftMultiplier: number;
}

export const DEFAULT_DIFFICULTY_CONFIG: DifficultyAdjustmentConfig = {
    targetBlockTimeMs: 10000, // 10 seconds per submission
    retargetInterval: 10,     // Retarget every 10 blocks (epoch mode)
    minDifficulty: 1,
    maxDifficulty: 8,
    maxAdjustmentFactor: 4,
    retargetWindowSize: 12,   // 12-block rolling window for DGW/DigiShield EMA (#5776)
    maxShiftFactor: 0.16,     // Dampen maximum single-block shift to +/- 16% (#5776)
    usePerBlockRetargeting: true,
};

export class ProofOfWorkValidator {
    private maxAgeMs: number;
    private currentDifficulty: number;
    private blockTimestamps: number[];
    private config: DifficultyAdjustmentConfig;

    constructor(
        maxAgeMs: number = 3600000, // 1 hour default
        initialDifficulty: number = 2,
        config: Partial<DifficultyAdjustmentConfig> = {}
    ) {
        this.maxAgeMs = maxAgeMs;
        this.currentDifficulty = initialDifficulty;
        this.blockTimestamps = [];
        this.config = { ...DEFAULT_DIFFICULTY_CONFIG, ...config };
    }

    private hash(data: string): string {
        return createHash('sha256').update(data).digest('hex');
    }

    /**
     * Validates if the submitted nonce produces a hash with the required number of leading zeros.
     */
    public validate(submission: PoWSubmission): boolean {
        // Check timestamp validity
        const now = Date.now();
        if (now - submission.timestamp > this.maxAgeMs) {
            console.warn('PoW submission expired');
            return false;
        }

        const payload = submission.merkleRoot + submission.nonce + submission.timestamp.toString();
        const hashResult = this.hash(payload);

        // Check leading zeros
        const leadingZerosRegex = new RegExp(`^0{${submission.difficulty}}`);
        if (!leadingZerosRegex.test(hashResult)) {
            console.warn('PoW hash does not meet difficulty requirement');
            return false;
        }

        return true;
    }

    /**
     * Calculates the exponential moving average (EMA) of block intervals over the rolling window.
     * Guards against timestamp manipulation by sorting and enforcing minimum interval bounds.
     */
    public static calculateEmaBlockTime(
        recentTimings: (number | BlockTimingInfo)[],
        windowSize: number = 12
    ): { emaBlockTimeMs: number; intervals: number[] } {
        const timestamps = recentTimings
            .map(t => (typeof t === 'number' ? t : t.timestamp))
            .filter(t => Number.isFinite(t) && t > 0)
            .sort((a, b) => a - b);

        if (timestamps.length < 2) {
            return { emaBlockTimeMs: 0, intervals: [] };
        }

        // Compute positive intervals, clamped to minimum 1ms to prevent division by zero / negative intervals
        const allIntervals: number[] = [];
        for (let i = 1; i < timestamps.length; i++) {
            const diff = Math.max(1, timestamps[i] - timestamps[i - 1]);
            allIntervals.push(diff);
        }

        // Take at most the last windowSize intervals (default 12 blocks)
        const windowIntervals = allIntervals.slice(-windowSize);
        if (windowIntervals.length === 0) {
            return { emaBlockTimeMs: 0, intervals: [] };
        }

        // Exponential Moving Average weighting (alpha = 2 / (N + 1))
        const alpha = 2 / (windowIntervals.length + 1);
        let ema = windowIntervals[0];
        for (let i = 1; i < windowIntervals.length; i++) {
            ema = alpha * windowIntervals[i] + (1 - alpha) * ema;
        }

        return {
            emaBlockTimeMs: Math.round(ema * 100) / 100,
            intervals: windowIntervals,
        };
    }

    /**
     * Recalculates difficulty on every block using an exponential moving average (EMA) of past 12 blocks,
     * dampening the maximum single-block difficulty shift to +/- 16% (DigiShield / Dark Gravity Wave style) (#5776).
     */
    public static recalculateEmaDifficulty(
        currentDifficulty: number,
        recentTimings: (number | BlockTimingInfo)[],
        configOverrides: Partial<DifficultyAdjustmentConfig> = {}
    ): EmaRetargetingResult {
        const config: DifficultyAdjustmentConfig = {
            ...DEFAULT_DIFFICULTY_CONFIG,
            ...configOverrides,
        };

        const windowSize = config.retargetWindowSize ?? 12;
        const maxShift = config.maxShiftFactor ?? 0.16; // 16%

        const { emaBlockTimeMs, intervals } = ProofOfWorkValidator.calculateEmaBlockTime(
            recentTimings,
            windowSize
        );

        if (intervals.length === 0 || emaBlockTimeMs <= 0) {
            return {
                newDifficulty: currentDifficulty,
                currentDifficulty,
                emaBlockTimeMs: config.targetBlockTimeMs,
                targetBlockTimeMs: config.targetBlockTimeMs,
                rawShiftPercent: 0,
                clampedShiftPercent: 0,
                shiftMultiplier: 1.0,
                isAdjusted: false,
                sampleCount: 0,
            };
        }

        // Ideal shift ratio: targetBlockTime / actualEmaTime
        // If actualTime < targetTime (mined too quickly), idealMultiplier > 1 => difficulty increases
        // If actualTime > targetTime (mined too slowly), idealMultiplier < 1 => difficulty decreases
        const idealMultiplier = config.targetBlockTimeMs / emaBlockTimeMs;
        const rawShiftPercent = idealMultiplier - 1.0;

        // Dampen single-block shift strictly within [-maxShift, +maxShift] (+/- 16%)
        const clampedShiftPercent = Math.max(-maxShift, Math.min(maxShift, rawShiftPercent));
        const shiftMultiplier = 1.0 + clampedShiftPercent;

        // Apply clamped multiplier and bound to [minDifficulty, maxDifficulty]
        const rawNewDifficulty = currentDifficulty * shiftMultiplier;
        const clampedDifficulty = Math.max(
            config.minDifficulty,
            Math.min(config.maxDifficulty, rawNewDifficulty)
        );

        // Keep 4 decimal places of continuous precision for smooth adaptation
        const newDifficulty = Math.round(clampedDifficulty * 10000) / 10000;

        return {
            newDifficulty,
            currentDifficulty,
            emaBlockTimeMs,
            targetBlockTimeMs: config.targetBlockTimeMs,
            rawShiftPercent: Math.round(rawShiftPercent * 10000) / 100, // e.g. 100.00%
            clampedShiftPercent: Math.round(clampedShiftPercent * 10000) / 100, // e.g. 16.00%
            shiftMultiplier: Math.round(shiftMultiplier * 10000) / 10000,
            isAdjusted: newDifficulty !== currentDifficulty,
            sampleCount: intervals.length,
        };
    }

    /**
     * Recalculates compact 32-bit difficulty bits on every block using the EMA of the past 12 blocks,
     * dampening the single-block target shift to +/- 16%.
     */
    public static recalculateEmaTargetBits(
        currentBits: number,
        recentTimings: (number | BlockTimingInfo)[],
        configOverrides: Partial<DifficultyAdjustmentConfig> = {}
    ): CompactBitsRetargetingResult {
        const config: DifficultyAdjustmentConfig = {
            ...DEFAULT_DIFFICULTY_CONFIG,
            ...configOverrides,
        };

        const currentTarget = ProofOfWorkValidator.decodeCompactBits(currentBits);
        const windowSize = config.retargetWindowSize ?? 12;
        const maxShift = config.maxShiftFactor ?? 0.16;

        const { emaBlockTimeMs, intervals } = ProofOfWorkValidator.calculateEmaBlockTime(
            recentTimings,
            windowSize
        );

        if (intervals.length === 0 || emaBlockTimeMs <= 0 || currentTarget === 0n) {
            return {
                newBits: currentBits,
                currentBits,
                newTarget: currentTarget,
                currentTarget,
                emaBlockTimeMs: config.targetBlockTimeMs,
                targetBlockTimeMs: config.targetBlockTimeMs,
                shiftMultiplier: 1.0,
            };
        }

        // For target: target decreases when difficulty increases (actual < target)
        // targetMultiplier = actualTime / targetTime
        const idealTargetMultiplier = emaBlockTimeMs / config.targetBlockTimeMs;
        const rawShift = idealTargetMultiplier - 1.0;
        const clampedShift = Math.max(-maxShift, Math.min(maxShift, rawShift));
        const shiftMultiplier = 1.0 + clampedShift;

        // Apply shift to 256-bit BigInt target
        const scale = 10000n;
        const scaledMultiplier = BigInt(Math.round(shiftMultiplier * 10000));
        let newTarget = (currentTarget * scaledMultiplier) / scale;

        const maxTarget = (1n << 256n) - 1n;
        if (newTarget > maxTarget) newTarget = maxTarget;
        if (newTarget <= 0n) newTarget = 1n;

        const newBits = ProofOfWorkValidator.encodeCompactBits(newTarget);

        return {
            newBits,
            currentBits,
            newTarget,
            currentTarget,
            emaBlockTimeMs,
            targetBlockTimeMs: config.targetBlockTimeMs,
            shiftMultiplier: Math.round(shiftMultiplier * 10000) / 10000,
        };
    }

    /**
     * Recalculates the adaptive mining difficulty based on observed block/submission timestamps
     * against target block intervals (epoch retargeting algorithm).
     * 
     * If actualTime < expectedTime (mined too fast), difficulty is increased.
     * If actualTime > expectedTime (mined too slow), difficulty is decreased.
     */
    public static recalculateAdaptiveDifficulty(
        currentDifficulty: number,
        recentTimings: (number | BlockTimingInfo)[],
        configOverrides: Partial<DifficultyAdjustmentConfig> = {}
    ): DifficultyRecalculationResult {
        const config: DifficultyAdjustmentConfig = {
            ...DEFAULT_DIFFICULTY_CONFIG,
            ...configOverrides,
        };

        if (recentTimings.length < 2) {
            return {
                newDifficulty: currentDifficulty,
                currentDifficulty,
                actualTimeMs: 0,
                expectedTimeMs: config.targetBlockTimeMs,
                adjustmentRatio: 1.0,
                isAdjusted: false,
            };
        }

        // Extract and sort numeric timestamps
        const timestamps = recentTimings
            .map(t => (typeof t === 'number' ? t : t.timestamp))
            .filter(t => Number.isFinite(t) && t > 0)
            .sort((a, b) => a - b);

        if (timestamps.length < 2) {
            return {
                newDifficulty: currentDifficulty,
                currentDifficulty,
                actualTimeMs: 0,
                expectedTimeMs: config.targetBlockTimeMs,
                adjustmentRatio: 1.0,
                isAdjusted: false,
            };
        }

        const firstTimestamp = timestamps[0];
        const lastTimestamp = timestamps[timestamps.length - 1];
        const actualTimeMs = Math.max(1, lastTimestamp - firstTimestamp);

        const intervalsCount = timestamps.length - 1;
        const expectedTimeMs = intervalsCount * config.targetBlockTimeMs;

        const rawRatio = actualTimeMs / expectedTimeMs;

        // Apply dampening bounds to prevent extreme fluctuations
        const maxFactor = Math.max(1.01, config.maxAdjustmentFactor);
        const minFactor = 1 / maxFactor;
        const adjustmentRatio = Math.max(minFactor, Math.min(maxFactor, rawRatio));

        // Adjust difficulty in inverse logarithmic steps:
        // actualTime < expectedTime => ratio < 1 => -log2(ratio) > 0 (difficulty increases)
        // actualTime > expectedTime => ratio > 1 => -log2(ratio) < 0 (difficulty decreases)
        const difficultyDelta = Math.round(-Math.log2(adjustmentRatio));
        const unclampedDifficulty = currentDifficulty + difficultyDelta;

        const newDifficulty = Math.max(
            config.minDifficulty,
            Math.min(config.maxDifficulty, unclampedDifficulty)
        );

        return {
            newDifficulty,
            currentDifficulty,
            actualTimeMs,
            expectedTimeMs,
            adjustmentRatio,
            isAdjusted: newDifficulty !== currentDifficulty,
        };
    }

    /**
     * Records a new block timestamp and returns the active adaptive difficulty.
     * When usePerBlockRetargeting is enabled, recalculates difficulty smoothly on every block (#5776).
     */
    public recordBlock(timestamp: number = Date.now()): number {
        this.blockTimestamps.push(timestamp);

        if (this.config.usePerBlockRetargeting) {
            // Retain at most (retargetWindowSize + 1) timestamps in memory
            const maxStored = (this.config.retargetWindowSize ?? 12) + 1;
            if (this.blockTimestamps.length > maxStored) {
                this.blockTimestamps.shift();
            }

            if (this.blockTimestamps.length >= 2) {
                const result = ProofOfWorkValidator.recalculateEmaDifficulty(
                    this.currentDifficulty,
                    this.blockTimestamps,
                    this.config
                );
                this.currentDifficulty = result.newDifficulty;
            }
            return this.currentDifficulty;
        }

        // Fallback epoch-based retargeting
        if (this.blockTimestamps.length >= this.config.retargetInterval) {
            const result = ProofOfWorkValidator.recalculateAdaptiveDifficulty(
                this.currentDifficulty,
                this.blockTimestamps,
                this.config
            );
            this.currentDifficulty = result.newDifficulty;
            // Keep the last timestamp to anchor the next epoch
            this.blockTimestamps = [this.blockTimestamps[this.blockTimestamps.length - 1]];
        }

        return this.currentDifficulty;
    }

    public getDifficulty(): number {
        return this.currentDifficulty;
    }

    public getIntegerDifficulty(): number {
        return Math.max(
            this.config.minDifficulty,
            Math.min(this.config.maxDifficulty, Math.round(this.currentDifficulty))
        );
    }

    public setDifficulty(difficulty: number): void {
        this.currentDifficulty = Math.max(
            this.config.minDifficulty,
            Math.min(this.config.maxDifficulty, difficulty)
        );
    }

    /**
     * Computes the 64-character hex target representation corresponding to a difficulty level.
     */
    public static calculateTargetHash(difficulty: number): string {
        const clampedDiff = Math.max(0, Math.min(64, Math.round(difficulty)));
        return '0'.repeat(clampedDiff) + 'f'.repeat(64 - clampedDiff);
    }

    /**
     * Checks if a hash satisfies the target difficulty.
     */
    public static meetsDifficultyTarget(hash: string, difficulty: number): boolean {
        if (!hash || typeof hash !== 'string') return false;
        const targetPrefix = '0'.repeat(Math.max(0, Math.round(difficulty)));
        return hash.startsWith(targetPrefix);
    }

    /**
     * Calculates the dynamic difficulty based on network load or spam rate.
     */
    public static calculateDifficulty(baseDifficulty: number, spamMultiplier: number): number {
        return Math.min(Math.max(baseDifficulty + Math.floor(spamMultiplier), 1), 8);
    }

    /**
     * Decodes compact 32-bit difficulty bits (e.g. 0x1d00ffff) into a 256-bit BigInt target hash.
     * Follows Bitcoin / Hashcash compact target representation:
     * - Exponent = bits >> 24
     * - Mantissa = bits & 0x007fffff (sign bit at 0x00800000 indicates negative)
     * - Target = mantissa * 256^(exponent - 3)
     * Handles sign bit edge cases and boundary targets accurately using BigInt to prevent integer truncation.
     */
    public static decodeCompactBits(bits: number): bigint {
        const exponent = (bits >>> 24) & 0xff;
        const isNegative = (bits & 0x00800000) !== 0;
        let mantissa = BigInt(bits & 0x007fffff);

        // If sign bit is set, or mantissa is 0, or exponent is 0, target is 0
        if (isNegative || mantissa === 0n || exponent === 0) {
            return 0n;
        }

        let target: bigint;
        if (exponent <= 3) {
            target = mantissa >> BigInt(8 * (3 - exponent));
        } else {
            target = mantissa << BigInt(8 * (exponent - 3));
        }

        // 256-bit maximum boundary clamp
        const maxTarget = (1n << 256n) - 1n;
        if (target > maxTarget) {
            return maxTarget;
        }

        return target;
    }

    /**
     * Encodes a 256-bit BigInt target into compact 32-bit bits integer representation.
     */
    public static encodeCompactBits(target: bigint): number {
        if (target <= 0n) return 0;

        let hex = target.toString(16);
        if (hex.length % 2 !== 0) {
            hex = '0' + hex;
        }

        let exponent = hex.length / 2;
        let mantissa = parseInt(hex.slice(0, 6), 16);

        // If the most significant bit of the 3-byte mantissa is 1 (>= 0x800000),
        // we shift right by 1 byte and increase exponent to avoid sign collision
        if (mantissa > 0x7fffff) {
            mantissa = parseInt(hex.slice(0, 4), 16);
            exponent += 1;
        }

        return ((exponent & 0xff) << 24) | (mantissa & 0x007fffff);
    }

    /**
     * Validates whether a 256-bit hexadecimal hash meets the difficulty target encoded in compact bits.
     */
    public static validateHashTarget(hashHex: string, compactBits: number): boolean {
        if (!hashHex || typeof hashHex !== 'string') return false;
        try {
            const cleanHex = hashHex.startsWith('0x') ? hashHex.slice(2) : hashHex;
            const hashInt = BigInt('0x' + cleanHex);
            const target = ProofOfWorkValidator.decodeCompactBits(compactBits);
            return hashInt <= target;
        } catch {
            return false;
        }
    }
}
