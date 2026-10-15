/**
 * DecibelEnforcementEngine.ts
 * Analyzes rolling audio buffers to calculate time-weighted average noise levels 
 * (Leq) and detect threshold breaches.
 */

export interface AudioAnalysisResult {
    currentDb: number;
    averageDb: number; // Leq over the window
    peakDb: number;
    isBreaching: boolean;
    breachDurationMs: number;
}

export class DecibelEnforcementEngine {
    private buffer: number[] = [];
    private maxBufferSize: number;
    private thresholdDb: number;
    private breachStartTime: number | null = null;
    private totalBreachDurationMs: number = 0;

    constructor(thresholdDb: number = 60, windowSizeSeconds: number = 10, sampleRate: number = 1) {
        this.thresholdDb = thresholdDb;
        // Assuming sampleRate is how many samples per second we push
        this.maxBufferSize = windowSizeSeconds * sampleRate;
    }

    public setThreshold(db: number): void {
        this.thresholdDb = db;
    }

    /**
     * Push a new decibel reading into the rolling buffer.
     * @param db The current decibel level (dBA)
     */
    public pushReading(db: number): void {
        this.buffer.push(db);
        if (this.buffer.length > this.maxBufferSize) {
            this.buffer.shift();
        }

        // Track breach duration
        if (db > this.thresholdDb) {
            if (this.breachStartTime === null) {
                this.breachStartTime = Date.now();
            }
        } else {
            if (this.breachStartTime !== null) {
                this.totalBreachDurationMs += Date.now() - this.breachStartTime;
                this.breachStartTime = null;
            }
        }
    }

    /**
     * Calculate the Equivalent Continuous Sound Level (Leq) over the current window.
     * Leq = 10 * log10( (1/T) * sum(10^(Li/10)) )
     */
    public calculateLeq(): number {
        if (this.buffer.length === 0) return 0;

        let sumEnergy = 0;
        for (const db of this.buffer) {
            sumEnergy += Math.pow(10, db / 10);
        }

        const avgEnergy = sumEnergy / this.buffer.length;
        return 10 * Math.log10(avgEnergy);
    }

    public getCurrentDb(): number {
        if (this.buffer.length === 0) return 0;
        return this.buffer[this.buffer.length - 1];
    }

    public getPeakDb(): number {
        if (this.buffer.length === 0) return 0;
        return Math.max(...this.buffer);
    }

    public analyze(): AudioAnalysisResult {
        const currentDb = this.getCurrentDb();
        const averageDb = this.calculateLeq();
        const peakDb = this.getPeakDb();

        let currentBreachDuration = this.totalBreachDurationMs;
        if (this.breachStartTime !== null) {
            currentBreachDuration += Date.now() - this.breachStartTime;
        }

        const isBreaching = currentDb > this.thresholdDb || averageDb > this.thresholdDb;

        return {
            currentDb,
            averageDb,
            peakDb,
            isBreaching,
            breachDurationMs: currentBreachDuration,
        };
    }

    public reset(): void {
        this.buffer = [];
        this.breachStartTime = null;
        this.totalBreachDurationMs = 0;
    }
}
