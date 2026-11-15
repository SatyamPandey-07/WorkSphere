/**
 * Measures RTT and ACK delay variance across the WebRTC mesh to 
 * mathematically identify the device saturating the local uplink.
 */

export interface PeerMetrics {
    peerId: string;
    rttHistory: number[];
    ackDelayHistory: number[];
    bytesSentPerSec: number;
    isHog: boolean;
}

export class PacketTimingAnalyzer {
    private peers: Map<string, PeerMetrics> = new Map();
    private windowSize: number = 20; // Rolling window for variance calculation

    constructor() { }

    public registerPeer(peerId: string): void {
        if (!this.peers.has(peerId)) {
            this.peers.set(peerId, {
                peerId,
                rttHistory: [],
                ackDelayHistory: [],
                bytesSentPerSec: 0,
                isHog: false,
            });
        }
    }

    /**
     * Records a new RTT sample for a specific peer.
     */
    public recordRTT(peerId: string, rttMs: number): void {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        peer.rttHistory.push(rttMs);
        if (peer.rttHistory.length > this.windowSize) {
            peer.rttHistory.shift();
        }
    }

    /**
     * Records the delay between sending a packet and receiving its ACK.
     * High ACK delays strongly indicate uplink saturation (bufferbloat).
     */
    public recordACKDelay(peerId: string, delayMs: number): void {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        peer.ackDelayHistory.push(delayMs);
        if (peer.ackDelayHistory.length > this.windowSize) {
            peer.ackDelayHistory.shift();
        }
    }

    public updateBandwidth(peerId: string, bytesPerSec: number): void {
        const peer = this.peers.get(peerId);
        if (peer) peer.bytesSentPerSec = bytesPerSec;
    }

    /**
     * Analyzes the mesh to identify the "Bandwidth Hog".
     * A hog is defined as a peer whose ACK delay variance is significantly 
     * higher than the mesh average, correlated with high upload throughput.
     */
    public identifyHog(): string | null {
        if (this.peers.size < 2) return null;

        let totalVariance = 0;
        let validPeers = 0;

        // Calculate average ACK delay variance across the mesh
        for (const peer of this.peers.values()) {
            if (peer.ackDelayHistory.length >= 5) {
                totalVariance += this.calculateVariance(peer.ackDelayHistory);
                validPeers++;
            }
        }

        if (validPeers === 0) return null;
        const avgVariance = totalVariance / validPeers;

        // Find the peer with the highest variance that is also uploading heavily
        let hogId: string | null = null;
        let maxScore = 0;

        for (const peer of this.peers.values()) {
            if (peer.ackDelayHistory.length < 5) continue;

            const variance = this.calculateVariance(peer.ackDelayHistory);
            // Score combines variance deviation and raw upload speed
            const score = (variance - avgVariance) * (peer.bytesSentPerSec / 100000);

            if (score > maxScore && variance > avgVariance * 2) {
                maxScore = score;
                hogId = peer.peerId;
                peer.isHog = true;
            } else {
                peer.isHog = false;
            }
        }

        return hogId;
    }

    private calculateVariance(arr: number[]): number {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    }

    public getMetrics(): PeerMetrics[] {
        return Array.from(this.peers.values());
    }
}
