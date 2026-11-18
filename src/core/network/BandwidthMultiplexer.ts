/**
 * BandwidthMultiplexer.ts
 * Manages the slicing of large TCP/UDP streams into micro-packets and distributes 
 * them across available peer tunnels to aggregate throughput.
 */

export interface MicroPacket {
    streamId: string;
    sequenceNumber: number;
    totalFragments: number;
    payload: Uint8Array;
    checksum: number;
    tunnelId: string;
}

export interface TunnelMetrics {
    tunnelId: string;
    latencyMs: number;
    throughputKbps: number;
    packetLossRate: number;
    isActive: boolean;
}

export class BandwidthMultiplexer {
    private activeTunnels: Map<string, TunnelMetrics> = new Map();
    private streamBuffers: Map<string, { fragments: Map<number, Uint8Array>; total: number; received: number }> = new Map();
    private roundRobinIndex: number = 0;

    constructor() { }

    /**
     * Registers a new WebRTC DataChannel tunnel for bandwidth aggregation.
     */
    public registerTunnel(metrics: TunnelMetrics): void {
        this.activeTunnels.set(metrics.tunnelId, metrics);
        console.log(`[Multiplexer] Tunnel registered: ${metrics.tunnelId} (${metrics.throughputKbps} Kbps)`);
    }

    /**
     * Removes a tunnel that has disconnected or fallen below minimum throughput thresholds.
     */
    public deregisterTunnel(tunnelId: string): void {
        this.activeTunnels.delete(tunnelId);
        console.log(`[Multiplexer] Tunnel deregistered: ${tunnelId}`);
    }

    /**
     * Updates real-time metrics for a specific tunnel to inform the load-balancing algorithm.
     */
    public updateTunnelMetrics(tunnelId: string, metrics: Partial<TunnelMetrics>): void {
        const existing = this.activeTunnels.get(tunnelId);
        if (existing) {
            this.activeTunnels.set(tunnelId, { ...existing, ...metrics });
        }
    }

    /**
     * Slices a large binary payload into micro-packets and assigns them to tunnels.
     * Uses a weighted round-robin approach based on current tunnel throughput.
     */
    public sliceAndDistribute(streamId: string, data: ArrayBuffer, chunkSize: number = 16384): MicroPacket[] {
        const packets: MicroPacket[] = [];
        const uint8View = new Uint8Array(data);
        const totalFragments = Math.ceil(uint8View.byteLength / chunkSize);

        const availableTunnels = Array.from(this.activeTunnels.values()).filter(t => t.isActive);
        if (availableTunnels.length === 0) {
            throw new Error('No active tunnels available for multiplexing.');
        }

        const weights = this.calculateWeights(availableTunnels);

        for (let i = 0; i < totalFragments; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, uint8View.byteLength);
            const fragment = uint8View.slice(start, end);

            const tunnel = this.selectTunnel(weights);
            const packet: MicroPacket = {
                streamId,
                sequenceNumber: i,
                totalFragments,
                payload: fragment,
                checksum: this.calculateChecksum(fragment),
                tunnelId: tunnel.tunnelId
            };

            packets.push(packet);
        }

        return packets;
    }

    /**
     * Reassembles incoming micro-packets into the original binary stream.
     * Returns the complete ArrayBuffer when all fragments are received and verified.
     */
    public reassemblePacket(packet: MicroPacket): ArrayBuffer | null {
        let streamState = this.streamBuffers.get(packet.streamId);

        if (!streamState) {
            streamState = {
                fragments: new Map(),
                total: packet.totalFragments,
                received: 0
            };
            this.streamBuffers.set(packet.streamId, streamState);
        }

        if (this.calculateChecksum(packet.payload) !== packet.checksum) {
            console.warn(`[Multiplexer] Checksum mismatch for stream ${packet.streamId}, fragment ${packet.sequenceNumber}`);
            return null; // Request retransmission in a full implementation
        }

        if (!streamState.fragments.has(packet.sequenceNumber)) {
            streamState.fragments.set(packet.sequenceNumber, packet.payload);
            streamState.received++;
        }

        if (streamState.received === streamState.total) {
            return this.compileStream(packet.streamId);
        }

        return null;
    }

    private compileStream(streamId: string): ArrayBuffer {
        const state = this.streamBuffers.get(streamId)!;
        const totalLength = Array.from(state.fragments.values()).reduce((acc, frag) => acc + frag.byteLength, 0);
        const compiled = new Uint8Array(totalLength);

        let offset = 0;
        for (let i = 0; i < state.total; i++) {
            const frag = state.fragments.get(i)!;
            compiled.set(frag, offset);
            offset += frag.byteLength;
        }

        this.streamBuffers.delete(streamId);
        return compiled.buffer;
    }

    private calculateWeights(tunnels: TunnelMetrics[]): number[] {
        const totalThroughput = tunnels.reduce((acc, t) => acc + t.throughputKbps, 0);
        return tunnels.map(t => totalThroughput > 0 ? t.throughputKbps / totalThroughput : 1 / tunnels.length);
    }

    private selectTunnel(weights: number[]): TunnelMetrics {
        const tunnels = Array.from(this.activeTunnels.values()).filter(t => t.isActive);
        let random = Math.random();

        for (let i = 0; i < tunnels.length; i++) {
            random -= weights[i];
            if (random <= 0) return tunnels[i];
        }

        return tunnels[tunnels.length - 1];
    }

    private calculateChecksum(data: Uint8Array): number {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum = (sum + data[i]) % 65535;
        }
        return sum;
    }
}
