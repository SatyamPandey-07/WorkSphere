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

    constructor(capacity: number = 168) { // Default to 1 week of hourly data (168 hours)
        this.capacity = capacity;
        this.buffer = new Float32Array(capacity);
        this.head = 0;
        this.count = 0;
    }

    public push(value: number): void {
        this.buffer[this.head] = value;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) {
            this.count++;
        }
    }

    public pushMultiple(values: number[]): void {
        for (const value of values) {
            this.push(value);
        }
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
    }
}
