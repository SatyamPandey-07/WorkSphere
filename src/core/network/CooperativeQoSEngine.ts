/**
 * Implements a distributed token-bucket algorithm to enforce fair-share 
 * bandwidth limits and prioritize real-time VoIP packets.
 */

export interface QoSPolicy {
    maxBandwidthBps: number; // Total venue capacity
    voipReserveBps: number;  // Reserved for voice/video
    fairShareFactor: number; // 0.0 to 1.0 (e.g., 0.8 = 80% of equal share)
}

export class TokenBucket {
    private tokens: number;
    private maxTokens: number;
    private refillRate: number; // Tokens per millisecond
    private lastRefill: number;

    constructor(capacityBytes: number, refillRateBps: number) {
        this.maxTokens = capacityBytes;
        this.tokens = capacityBytes;
        this.refillRate = refillRateBps / 1000; // Convert bps to bytes/ms
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
        this.refillRate = newRateBps / 1000;
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
        this.lastRefill = now;
    }
}

export class CooperativeQoSEngine {
    private policy: QoSPolicy;
    private buckets: Map<string, TokenBucket> = new Map();
    private activePeers: number = 0;

    constructor(policy: QoSPolicy) {
        this.policy = policy;
    }

    public addPeer(peerId: string): void {
        if (!this.buckets.has(peerId)) {
            this.activePeers++;
            this.recalculateLimits();
        }
    }

    public removePeer(peerId: string): void {
        if (this.buckets.has(peerId)) {
            this.buckets.delete(peerId);
            this.activePeers--;
            this.recalculateLimits();
        }
    }

    /**
     * Throttles the "Bandwidth Hog" by reducing their token refill rate.
     */
    public penalizePeer(peerId: string, penaltyFactor: number): void {
        const bucket = this.buckets.get(peerId);
        if (bucket) {
            const baseRate = this.calculateFairShareRate();
            bucket.setRate(baseRate * penaltyFactor);
        }
    }

    public restorePeer(peerId: string): void {
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
