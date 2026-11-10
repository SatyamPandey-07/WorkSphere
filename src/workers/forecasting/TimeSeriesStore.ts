/**
 * TimeSeriesStore.ts
 * Circular buffer logic for efficiently storing and retrieving historical occupancy telemetry 
 * without unbounded memory growth in the Web Worker environment.
 */

export class TimeSeriesStore {
    private buffer: Float32Array;
    private capacity: number;
    private head: number;
    private count: number;
    private mean: number;
    private m2: number;

    constructor(capacity: number = 168) { // Default to 1 week of hourly data (168 hours)
        this.capacity = capacity;
        this.buffer = new Float32Array(capacity);
        this.head = 0;
        this.count = 0;
        this.mean = 0;
        this.m2 = 0;
    }

    public push(value: number): void {
        const isFull = this.count >= this.capacity;
        this.buffer[this.head] = value;
        this.head = (this.head + 1) % this.capacity;

        if (!isFull) {
            this.count++;
            const delta = value - this.mean;
            this.mean += delta / this.count;
            const delta2 = value - this.mean;
            this.m2 += delta * delta2;
            if (this.m2 < 0) this.m2 = 0;
        } else {
            this.recomputeWelford();
        }
    }

    public pushMultiple(values: number[]): void {
        for (const value of values) {
            this.push(value);
        }
    }

    /**
     * Recomputes mean and M2 using Welford's algorithm across the circular buffer.
     * Prevents floating-point drift and catastrophic cancellation upon sliding-window eviction.
     */
    private recomputeWelford(): void {
        let mean = 0;
        let m2 = 0;

        for (let i = 0; i < this.count; i++) {
            const index = (this.head - this.count + i + this.capacity) % this.capacity;
            const x = this.buffer[index];
            const k = i + 1;
            const delta = x - mean;
            mean += delta / k;
            const delta2 = x - mean;
            m2 += delta * delta2;
        }

        this.mean = mean;
        this.m2 = Math.max(0, m2);
    }

    /**
     * Calculates rolling variance using Welford's online algorithm.
     * Eliminates catastrophic cancellation and guarantees non-negative variance.
     * @param sample Whether to compute sample variance (N - 1) instead of population variance (N).
     */
    public getVariance(sample: boolean = false): number {
        if (this.count === 0) return 0;
        if (sample && this.count <= 1) return 0;

        const divisor = sample ? this.count - 1 : this.count;
        if (divisor <= 0) return 0;

        const variance = Math.max(0, this.m2) / divisor;
        return Number.isFinite(variance) ? variance : 0;
    }

    public getRollingVariance(sample: boolean = false): number {
        return this.getVariance(sample);
    }

    /**
     * Calculates rolling standard deviation using Welford's algorithm.
     * Guaranteed never to produce NaN.
     * @param sample Whether to compute sample standard deviation.
     */
    public getStandardDeviation(sample: boolean = false): number {
        const variance = this.getVariance(sample);
        return Math.sqrt(Math.max(0, variance));
    }

    public getRollingStandardDeviation(sample: boolean = false): number {
        return this.getStandardDeviation(sample);
    }

    /**
     * Returns the rolling mean of the buffer.
     */
    public getMean(): number {
        return this.count > 0 ? this.mean : 0;
    }

    public getRollingMean(): number {
        return this.getMean();
    }

    /**
     * Returns the data in chronological order (oldest to newest).
     */
    public getData(): number[] {
        const result = new Array(this.count);
        for (let i = 0; i < this.count; i++) {
            const index = (this.head - this.count + i + this.capacity) % this.capacity;
            result[i] = this.buffer[index];
        }
        return result;
    }

    public getCount(): number {
        return this.count;
    }

    public clear(): void {
        this.buffer.fill(0);
        this.head = 0;
        this.count = 0;
        this.mean = 0;
        this.m2 = 0;
    }
}
