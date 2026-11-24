/**
 * Implements a distributed token-bucket algorithm to enforce fair-share 
 * bandwidth limits and prioritize real-time VoIP packets.
 */

export interface QoSPolicy {
    maxBandwidthBps: number; // Total venue capacity
    voipReserveBps: number;  // Reserved for voice/video
    fairShareFactor: number; // 0.0 to 1.0 (e.g., 0.8 = 80% of equal share)
}

export const BITS_PER_BYTE = 8;
export const MS_PER_SECOND = 1000;
export const BPS_TO_BYTES_PER_MS = BITS_PER_BYTE * MS_PER_SECOND; // 8000 bps = 1 byte/ms = 1000 bytes/sec

export class TokenBucket {
    private tokens: number;
    private maxTokens: number;
    private refillRateBytesPerMs: number; // Tokens (bytes) per millisecond
    private lastRefill: number;

    constructor(capacityBytes: number, refillRateBps: number) {
        this.maxTokens = capacityBytes;
        this.tokens = capacityBytes;
        // 8 bits per byte, 1000 ms per second -> divide bps by 8000 to get bytes/ms
        this.refillRateBytesPerMs = refillRateBps / BPS_TO_BYTES_PER_MS;
        this.lastRefill = Date.now();
    }

    public consume(bytes: number): boolean {
        this.refill();
        if (this.tokens >= bytes) {
            this.tokens -= bytes;
            return true;
        }
        return false;
    }

    public setRate(newRateBps: number): void {
        this.refillRateBytesPerMs = newRateBps / BPS_TO_BYTES_PER_MS;
    }

    public get refillRate(): number {
        return this.refillRateBytesPerMs;
    }

    public getRefillRateBytesPerMs(): number {
        return this.refillRateBytesPerMs;
    }

    public getRefillRateBps(): number {
        return this.refillRateBytesPerMs * BPS_TO_BYTES_PER_MS;
    }

    public getTokens(): number {
        this.refill();
        return this.tokens;
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = Math.max(0, now - this.lastRefill);
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRateBytesPerMs);
        this.lastRefill = now;
    }
}

export class CooperativeQoSEngine {
    private policy: QoSPolicy;
    private buckets: Map<string, TokenBucket> = new Map();
    private registeredPeers: Set<string> = new Set();
    private hasExplicitRegistrations: boolean = false;
    public activePeers: number = 0;

    constructor(policy: QoSPolicy) {
        this.policy = policy;
    }

    public addPeer(peerId: string): void {
        this.hasExplicitRegistrations = true;
        if (!this.registeredPeers.has(peerId)) {
            this.registeredPeers.add(peerId);
            this.activePeers = this.registeredPeers.size;
            this.recalculateLimits();
        }
    }

    public removePeer(peerId: string): void {
        if (this.registeredPeers.has(peerId)) {
            this.registeredPeers.delete(peerId);
            this.buckets.delete(peerId);
            this.activePeers = this.registeredPeers.size;
            this.recalculateLimits();
        }
    }

    public hasPeer(peerId: string): boolean {
        return this.registeredPeers.has(peerId);
    }

    public getActivePeers(): number {
        return this.registeredPeers.size;
    }

    public getRegisteredPeers(): string[] {
        return Array.from(this.registeredPeers);
    }

    public getFairShareRate(): number {
        return this.calculateFairShareRate();
    }

    public getBucket(peerId: string): TokenBucket | undefined {
        return this.buckets.get(peerId);
    }

    /**
     * Throttles the "Bandwidth Hog" by reducing their token refill rate.
     */
    public penalizePeer(peerId: string, penaltyFactor: number): void {
        if (this.hasExplicitRegistrations && !this.registeredPeers.has(peerId)) return;
        const bucket = this.buckets.get(peerId);
        if (bucket) {
            const baseRate = this.calculateFairShareRate();
            bucket.setRate(baseRate * penaltyFactor);
        }
    }

    public restorePeer(peerId: string): void {
        if (this.hasExplicitRegistrations && !this.registeredPeers.has(peerId)) return;
        const bucket = this.buckets.get(peerId);
        if (bucket) {
            bucket.setRate(this.calculateFairShareRate());
        }
    }

    /**
     * Checks if a packet is allowed to be sent based on the token bucket.
     * Priority traffic (VoIP) bypasses the bucket.
     */
    public allowPacket(peerId: string, bytes: number, isPriority: boolean): boolean {
        if (isPriority) return true;

        if (this.hasExplicitRegistrations && !this.registeredPeers.has(peerId)) {
            return false;
        }

        let bucket = this.buckets.get(peerId);
        if (!bucket) {
            bucket = new TokenBucket(1024 * 1024, this.calculateFairShareRate());
            this.buckets.set(peerId, bucket);
        }

        return bucket.consume(bytes);
    }

    private recalculateLimits(): void {
        const fairRate = this.calculateFairShareRate();
        for (const bucket of this.buckets.values()) {
            bucket.setRate(fairRate);
        }
    }

    private calculateFairShareRate(): number {
        if (this.activePeers <= 0) return this.policy.maxBandwidthBps;

        const availableBandwidth = this.policy.maxBandwidthBps - this.policy.voipReserveBps;
        const equalShare = availableBandwidth / this.activePeers;

        return equalShare * this.policy.fairShareFactor;
    }
}
