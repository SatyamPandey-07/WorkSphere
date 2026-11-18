import {
    SocketTelemetryCollector,
    PacketTelemetryEvent
} from '../../core/network/SocketTelemetryCollector';

describe('SocketTelemetryCollector', () => {
    let collector: SocketTelemetryCollector;

    beforeEach(() => {
        collector = new SocketTelemetryCollector({
            maxSrttUs: 40_000,         // 40 ms
            maxJitterUs: 10_000,       // 10 ms
            maxRetransmitPercent: 2.0  // 2%
        });
    });

    describe('Packet Ingestion & Jacobson SRTT Convergence', () => {
        it('initializes SRTT on first packet and smooths subsequent latency variations', () => {
            const firstPacket: PacketTelemetryEvent = {
                socketId: 'sock-tcp-01',
                protocol: 'TCP',
                srcAddress: '10.0.0.1:443',
                dstAddress: '192.168.1.50:54321',
                timestampUs: 1000000,
                rttUs: 20000, // 20 ms
                bytes: 1420
            };

            const metrics1 = collector.recordPacket(firstPacket);
            expect(metrics1.totalPackets).toBe(1);
            expect(metrics1.srttUs).toBe(20000);
            expect(metrics1.minRttUs).toBe(20000);
            expect(metrics1.maxRttUs).toBe(20000);

            // Record steady packets
            for (let i = 0; i < 5; i++) {
                collector.recordPacket({
                    ...firstPacket,
                    timestampUs: 1000000 + (i + 1) * 20000,
                    rttUs: 20000
                });
            }

            const steadyMetrics = collector.getMetrics('sock-tcp-01');
            expect(steadyMetrics?.srttUs).toBe(20000);
            expect(steadyMetrics?.totalPackets).toBe(6);
            expect(steadyMetrics?.slaStatus).toBe('HEALTHY');
        });

        it('smooths high-latency spike without abrupt deviation', () => {
            const basePacket: PacketTelemetryEvent = {
                socketId: 'sock-tcp-02',
                protocol: 'TCP',
                srcAddress: '10.0.0.1:443',
                dstAddress: '192.168.1.51:54322',
                timestampUs: 2000000,
                rttUs: 20000,
                bytes: 1420
            };
            collector.recordPacket(basePacket);

            // Latency spike of 60ms
            const spikeMetrics = collector.recordPacket({
                ...basePacket,
                timestampUs: 2020000,
                rttUs: 60000
            });

            // 0.875 * 20000 + 0.125 * 60000 = 17500 + 7500 = 25000 us
            expect(spikeMetrics.srttUs).toBe(25000);
            expect(spikeMetrics.maxRttUs).toBe(60000);
        });
    });

    describe('RFC 3550 Interarrival Jitter', () => {
        it('tracks jitter progression across fluctuating packet deliveries', () => {
            const socketId = 'sock-udp-voice-01';
            let timestamp = 3000000;

            const latencies = [15000, 25000, 10000, 30000, 12000];
            for (const rtt of latencies) {
                collector.recordPacket({
                    socketId,
                    protocol: 'UDP',
                    srcAddress: '10.0.0.2:5004',
                    dstAddress: '192.168.1.52:5004',
                    timestampUs: timestamp,
                    rttUs: rtt,
                    bytes: 160
                });
                timestamp += 20000;
            }

            const metrics = collector.getMetrics(socketId);
            expect(metrics?.rfc3550JitterUs).toBeGreaterThan(0);
            expect(metrics?.totalPackets).toBe(5);
        });
    });

    describe('Sliding-Window Percentile Latency Analysis', () => {
        it('calculates p50, p90, and p99 from sliding sample window', () => {
            const socketId = 'sock-tcp-percentiles';
            // Ingest 100 packets with linear latencies from 1ms (1000us) to 100ms (100000us)
            for (let i = 1; i <= 100; i++) {
                collector.recordPacket({
                    socketId,
                    protocol: 'TCP',
                    srcAddress: '10.0.0.3:80',
                    dstAddress: '192.168.1.53:4000',
                    timestampUs: 4000000 + i * 1000,
                    rttUs: i * 1000,
                    bytes: 512
                });
            }

            const metrics = collector.getMetrics(socketId)!;
            expect(metrics.p50RttUs).toBe(50000);
            expect(metrics.p90RttUs).toBe(90000);
            expect(metrics.p99RttUs).toBe(99000);
        });
    });

    describe('TCP Retransmissions & SLA Alerting', () => {
        it('calculates retransmission percentage and triggers SLA alerts when targets are breached', () => {
            const socketId = 'sock-degraded';
            // Record 10 packets, 1 with 1 retransmit -> 10% retransmit rate
            for (let i = 0; i < 10; i++) {
                collector.recordPacket({
                    socketId,
                    protocol: 'TCP',
                    srcAddress: '10.0.0.4:443',
                    dstAddress: '192.168.1.54:4001',
                    timestampUs: 5000000 + i * 1000,
                    rttUs: 25000,
                    bytes: 1420,
                    retransmits: i === 0 ? 1 : 0
                });
            }

            const metrics = collector.getMetrics(socketId)!;
            expect(metrics.retransmitRatePercent).toBe(10); // 10% > 2% max
            expect(['DEGRADED', 'CRITICAL']).toContain(metrics.slaStatus);
            expect(metrics.alerts.some(a => a.includes('retransmissions') || a.includes('packet loss'))).toBe(true);
        });

        it('flags CRITICAL status when SRTT exceeds 1.5x threshold', () => {
            const socketId = 'sock-critical-lag';
            collector.recordPacket({
                socketId,
                protocol: 'TCP',
                srcAddress: '10.0.0.5:443',
                dstAddress: '192.168.1.55:4002',
                timestampUs: 6000000,
                rttUs: 100000, // 100 ms > 1.5 * 40 ms = 60 ms
                bytes: 1024
            });

            const metrics = collector.getMetrics(socketId)!;
            expect(metrics.slaStatus).toBe('CRITICAL');
            expect(metrics.alerts.some(a => a.includes('High SRTT latency'))).toBe(true);
        });
    });
});
