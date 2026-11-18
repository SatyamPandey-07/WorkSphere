/**
 * AdaptiveJitterBuffer.ts
 *
 * Sizes the WebRTC audio playout delay from live network conditions. It keeps
 * an exponential moving average (EMA) of RTT samples and a rolling variance of
 * packet inter-arrival times, then derives a target playout delay that is
 * clamped between a low-latency floor (20ms) and a stability ceiling (200ms).
 *
 * Stable Wi-Fi links stay near the floor for ultra-crisp audio, while jittery
 * mobile links push the buffer deeper to avoid robotic dropouts.
 */

export interface AdaptiveJitterBufferOptions {
    /** Lowest playout delay the buffer may request. Defaults to 20ms. */
    minDelayMs?: number;
    /** Highest playout delay the buffer may request. Defaults to 200ms. */
    maxDelayMs?: number;
    /** EMA smoothing factor for RTT samples, in (0, 1]. Defaults to 0.2. */
    rttEmaAlpha?: number;
    /** Number of recent inter-arrival deltas used for the variance. Defaults to 20. */
    varianceWindowSize?: number;
    /** Weight applied to the RTT EMA when sizing the buffer. Defaults to 0.5. */
    rttWeight?: number;
    /** Multiplier applied to the arrival jitter (standard deviation). Defaults to 4. */
    jitterMultiplier?: number;
    /** Fixed headroom added before clamping. Defaults to 10ms. */
    safetyMarginMs?: number;
}

export interface JitterBufferStats {
    /** Smoothed RTT, or null before the first sample. */
    rttEmaMs: number | null;
    /** Standard deviation of recent packet inter-arrival times. */
    jitterMs: number;
    /** Population variance of recent packet inter-arrival times. */
    variance: number;
    /** Currently recommended playout delay, already clamped. */
    targetDelayMs: number;
    /** Number of arrival timestamps observed. */
    arrivalCount: number;
}

const DEFAULT_MIN_DELAY_MS = 20;
const DEFAULT_MAX_DELAY_MS = 200;
const DEFAULT_RTT_EMA_ALPHA = 0.2;
const DEFAULT_VARIANCE_WINDOW_SIZE = 20;
const DEFAULT_RTT_WEIGHT = 0.5;
const DEFAULT_JITTER_MULTIPLIER = 4;
const DEFAULT_SAFETY_MARGIN_MS = 10;

export class AdaptiveJitterBuffer {
    private readonly minDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly rttEmaAlpha: number;
    private readonly varianceWindowSize: number;
    private readonly rttWeight: number;
    private readonly jitterMultiplier: number;
    private readonly safetyMarginMs: number;

    private rttEmaMs: number | null = null;
    private intervals: number[] = [];
    private lastArrivalMs: number | null = null;
    private arrivalCount = 0;

    constructor(options: AdaptiveJitterBufferOptions = {}) {
        this.minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
        this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
        this.rttEmaAlpha = options.rttEmaAlpha ?? DEFAULT_RTT_EMA_ALPHA;
        this.varianceWindowSize = options.varianceWindowSize ?? DEFAULT_VARIANCE_WINDOW_SIZE;
        this.rttWeight = options.rttWeight ?? DEFAULT_RTT_WEIGHT;
        this.jitterMultiplier = options.jitterMultiplier ?? DEFAULT_JITTER_MULTIPLIER;
        this.safetyMarginMs = options.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS;

        if (!Number.isFinite(this.minDelayMs) || !Number.isFinite(this.maxDelayMs)) {
            throw new RangeError('Delay bounds must be finite numbers.');
        }
        if (this.minDelayMs < 0 || this.maxDelayMs < this.minDelayMs) {
            throw new RangeError('Delay bounds must satisfy 0 <= minDelayMs <= maxDelayMs.');
        }
        if (!(this.rttEmaAlpha > 0 && this.rttEmaAlpha <= 1)) {
            throw new RangeError('rttEmaAlpha must be within (0, 1].');
        }
        if (!Number.isInteger(this.varianceWindowSize) || this.varianceWindowSize < 2) {
            throw new RangeError('varianceWindowSize must be an integer >= 2.');
        }
    }

    /**
     * Records an RTT measurement (ms) and folds it into the EMA estimator.
     * The first sample seeds the average; later samples are smoothed.
     */
    public recordRttSample(rttMs: number): void {
        if (!Number.isFinite(rttMs) || rttMs < 0) {
            throw new RangeError('RTT sample must be a finite, non-negative number.');
        }
        this.rttEmaMs = this.rttEmaMs === null
            ? rttMs
            : this.rttEmaAlpha * rttMs + (1 - this.rttEmaAlpha) * this.rttEmaMs;
    }

    /**
     * Records a packet arrival timestamp (ms). The gap from the previous
     * in-order packet becomes a sample of the inter-arrival variance.
     */
    public recordPacketArrival(arrivalMs: number): void {
        if (!Number.isFinite(arrivalMs)) {
            throw new RangeError('Packet arrival timestamp must be a finite number.');
        }

        this.arrivalCount++;

        if (this.lastArrivalMs === null) {
            this.lastArrivalMs = arrivalMs;
            return;
        }

        const interval = arrivalMs - this.lastArrivalMs;
        if (interval < 0) {
            // Out-of-order or duplicate timestamp; keep the reference point intact.
            return;
        }

        this.lastArrivalMs = arrivalMs;
        this.intervals.push(interval);
        if (this.intervals.length > this.varianceWindowSize) {
            this.intervals.shift();
        }
    }

    /** Population variance of the recent packet inter-arrival deltas. */
    public getVariance(): number {
        if (this.intervals.length < 2) {
            return 0;
        }
        const mean = this.intervals.reduce((sum, value) => sum + value, 0) / this.intervals.length;
        const squaredDeviations = this.intervals.reduce(
            (sum, value) => sum + (value - mean) ** 2,
            0
        );
        return squaredDeviations / this.intervals.length;
    }

    /** Arrival jitter, expressed as the standard deviation of inter-arrival times. */
    public getJitterMs(): number {
        return Math.sqrt(this.getVariance());
    }

    public getRttEmaMs(): number | null {
        return this.rttEmaMs;
    }

    /**
     * Target playout delay derived from RTT and arrival jitter, clamped to the
     * configured [minDelayMs, maxDelayMs] window.
     */
    public getTargetDelayMs(): number {
        const rttComponent = (this.rttEmaMs ?? 0) * this.rttWeight;
        const jitterComponent = this.getJitterMs() * this.jitterMultiplier;
        const rawDelay = this.safetyMarginMs + rttComponent + jitterComponent;
        const clamped = Math.min(this.maxDelayMs, Math.max(this.minDelayMs, rawDelay));
        return Math.round(clamped);
    }

    public getStats(): JitterBufferStats {
        return {
            rttEmaMs: this.rttEmaMs,
            jitterMs: this.getJitterMs(),
            variance: this.getVariance(),
            targetDelayMs: this.getTargetDelayMs(),
            arrivalCount: this.arrivalCount,
        };
    }

    /** Clears all learned network state, returning to the low-latency floor. */
    public reset(): void {
        this.rttEmaMs = null;
        this.intervals = [];
        this.lastArrivalMs = null;
        this.arrivalCount = 0;
    }
}
