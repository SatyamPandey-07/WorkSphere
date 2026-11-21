/**
 * @file SocketTelemetryCollector.ts
 * @description eBPF-inspired socket latency, jitter, and degradation telemetry collector.
 * Implements microsecond-precision Jacobson's SRTT/RTTVAR, RFC 3550 interarrival jitter,
 * sliding-window percentile latency profiling (p50, p90, p99), and SLA breach alerting.
 */

export type SocketProtocol = 'TCP' | 'UDP';

export interface PacketTelemetryEvent {
    socketId: string;
    protocol: SocketProtocol;
    srcAddress: string;
    dstAddress: string;
    timestampUs: number;         // Microsecond epoch
    rttUs: number;               // Round Trip Time in microseconds
    bytes: number;
    retransmits?: number;        // Incremental retransmission count
}

export interface SocketSLATargets {
    maxSrttUs: number;           // e.g. 50,000 us (50 ms)
    maxJitterUs: number;         // e.g. 15,000 us (15 ms)
    maxRetransmitPercent: number;// e.g. 2.0%
}

export type SLAStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface SocketMetrics {
    socketId: string;
    protocol: SocketProtocol;
    totalPackets: number;
    totalBytes: number;
    srttUs: number;              // Smoothed RTT (EWMA)
    rttvarUs: number;            // RTT Variance
    rfc3550JitterUs: number;     // RFC 3550 Interarrival Jitter
    minRttUs: number;
    maxRttUs: number;
    p50RttUs: number;
    p90RttUs: number;
    p99RttUs: number;
    retransmitRatePercent: number;
    slaStatus: SLAStatus;
    alerts: string[];
}

interface SocketInternalState {
    socketId: string;
    protocol: SocketProtocol;
    srcAddress: string;
    dstAddress: string;
    totalPackets: number;
    totalBytes: number;
    totalRetransmits: number;
    srttUs: number;
    rttvarUs: number;
    rfc3550JitterUs: number;
    lastRttUs: number;
    minRttUs: number;
    maxRttUs: number;
    rttWindow: number[];
}

export class SocketTelemetryCollector {
    private sockets: Map<string, SocketInternalState> = new Map();
    private slaTargets: SocketSLATargets;
    private maxWindowSize: number;

    constructor(customSla?: Partial<SocketSLATargets>, windowSize: number = 200) {
        this.slaTargets = {
            maxSrttUs: 50_000,          // 50ms
            maxJitterUs: 15_000,        // 15ms
            maxRetransmitPercent: 2.5,  // 2.5%
            ...customSla
        };
        this.maxWindowSize = windowSize;
    }

    /**
     * Ingests a packet telemetry event and updates socket metrics in real time.
     */
    public recordPacket(event: PacketTelemetryEvent): SocketMetrics {
        let state = this.sockets.get(event.socketId);

        if (!state) {
            state = {
                socketId: event.socketId,
                protocol: event.protocol,
                srcAddress: event.srcAddress,
                dstAddress: event.dstAddress,
                totalPackets: 0,
                totalBytes: 0,
                totalRetransmits: 0,
                srttUs: event.rttUs,
                rttvarUs: event.rttUs / 2,
                rfc3550JitterUs: 0,
                lastRttUs: event.rttUs,
                minRttUs: event.rttUs,
                maxRttUs: event.rttUs,
                rttWindow: []
            };
            this.sockets.set(event.socketId, state);
        }

        state.totalPackets++;
        state.totalBytes += event.bytes;
        if (event.retransmits) {
            state.totalRetransmits += event.retransmits;
        }

        // 1. Min / Max Tracking
        if (event.rttUs < state.minRttUs) state.minRttUs = event.rttUs;
        if (event.rttUs > state.maxRttUs) state.maxRttUs = event.rttUs;

        // 2. Jacobson's Algorithm for SRTT & RTTVAR
        // SRTT = (1 - alpha) * SRTT + alpha * RTT (alpha = 1/8 = 0.125)
        // RTTVAR = (1 - beta) * RTTVAR + beta * |SRTT - RTT| (beta = 1/4 = 0.25)
        if (state.totalPackets === 1) {
            state.srttUs = event.rttUs;
            state.rttvarUs = event.rttUs / 2;
        } else {
            const diff = Math.abs(state.srttUs - event.rttUs);
            state.rttvarUs = Math.round(0.75 * state.rttvarUs + 0.25 * diff);
            state.srttUs = Math.round(0.875 * state.srttUs + 0.125 * event.rttUs);
        }

        // 3. RFC 3550 Interarrival Jitter
        // J = J + (|D(i-1, i)| - J) / 16
        if (state.totalPackets > 1) {
            const delta = Math.abs(event.rttUs - state.lastRttUs);
            state.rfc3550JitterUs = Math.round(state.rfc3550JitterUs + (delta - state.rfc3550JitterUs) / 16);
        }
        state.lastRttUs = event.rttUs;

        // 4. Sliding Window Percentiles
        state.rttWindow.push(event.rttUs);
        if (state.rttWindow.length > this.maxWindowSize) {
            state.rttWindow.shift();
        }

        return this.computeMetrics(state);
    }

    /**
     * Ingests a batch of telemetry events.
     */
    public recordBatch(events: PacketTelemetryEvent[]): void {
        for (const ev of events) {
            this.recordPacket(ev);
        }
    }

    /**
     * Returns computed metrics and health status for a specific socket.
     */
    public getMetrics(socketId: string): SocketMetrics | undefined {
        const state = this.sockets.get(socketId);
        if (!state) return undefined;
        return this.computeMetrics(state);
    }

    /**
     * Returns all tracked sockets metrics.
     */
    public getAllMetrics(): SocketMetrics[] {
        return Array.from(this.sockets.values()).map(s => this.computeMetrics(s));
    }

    /**
     * Resets telemetry metrics for a socket.
     */
    public resetSocket(socketId: string): void {
        this.sockets.delete(socketId);
    }

    // --- Private Metric & SLA Calculations ---

    private computeMetrics(state: SocketInternalState): SocketMetrics {
        // Percentiles
        const sorted = [...state.rttWindow].sort((a, b) => a - b);
        const p50 = this.getPercentile(sorted, 50);
        const p90 = this.getPercentile(sorted, 90);
        const p99 = this.getPercentile(sorted, 99);

        // Retransmission rate (%)
        const retransmitRatePercent = state.totalPackets > 0
            ? Math.round((state.totalRetransmits / state.totalPackets) * 1000) / 10
            : 0;

        // SLA Evaluation
        const alerts: string[] = [];
        let slaStatus: SLAStatus = 'HEALTHY';

        if (state.srttUs > this.slaTargets.maxSrttUs * 1.5) {
            slaStatus = 'CRITICAL';
            alerts.push(`High SRTT latency: ${state.srttUs} us (exceeds 1.5x SLA ceiling ${this.slaTargets.maxSrttUs} us)`);
        } else if (state.srttUs > this.slaTargets.maxSrttUs) {
            slaStatus = 'DEGRADED';
            alerts.push(`SRTT latency elevated: ${state.srttUs} us > ${this.slaTargets.maxSrttUs} us`);
        }

        if (state.rfc3550JitterUs > this.slaTargets.maxJitterUs * 1.5) {
            slaStatus = 'CRITICAL';
            alerts.push(`Critical jitter spike: ${state.rfc3550JitterUs} us (exceeds ${this.slaTargets.maxJitterUs} us)`);
        } else if (state.rfc3550JitterUs > this.slaTargets.maxJitterUs && slaStatus !== 'CRITICAL') {
            slaStatus = 'DEGRADED';
            alerts.push(`Packet jitter elevated: ${state.rfc3550JitterUs} us > ${this.slaTargets.maxJitterUs} us`);
        }

        if (retransmitRatePercent > this.slaTargets.maxRetransmitPercent * 2) {
            slaStatus = 'CRITICAL';
            alerts.push(`Severe packet loss / retransmits: ${retransmitRatePercent}%`);
        } else if (retransmitRatePercent > this.slaTargets.maxRetransmitPercent && slaStatus !== 'CRITICAL') {
            slaStatus = 'DEGRADED';
            alerts.push(`Packet retransmissions elevated: ${retransmitRatePercent}%`);
        }

        return {
            socketId: state.socketId,
            protocol: state.protocol,
            totalPackets: state.totalPackets,
            totalBytes: state.totalBytes,
            srttUs: state.srttUs,
            rttvarUs: state.rttvarUs,
            rfc3550JitterUs: state.rfc3550JitterUs,
            minRttUs: state.minRttUs,
            maxRttUs: state.maxRttUs,
            p50RttUs: p50,
            p90RttUs: p90,
            p99RttUs: p99,
            retransmitRatePercent,
            slaStatus,
            alerts
        };
    }

    private getPercentile(sorted: number[], p: number): number {
        if (sorted.length === 0) return 0;
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
    }
}
