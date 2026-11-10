/**
 * ProtocolLatencyMatrix
 * Correlates probe results to generate a compatibility matrix for specific remote-work protocols.
 */

import { FingerprintResult, NATType } from './NetworkFingerprinter';

export enum WorkProtocol {
    SSH = 'SSH',
    WEBRTC_VOICE = 'WEBRTC_VOICE',
    WEBRTC_VIDEO = 'WEBRTC_VIDEO',
    SIP = 'SIP',
    RDP = 'RDP',
    UDP_GAMING = 'UDP_GAMING'
}

export interface ProtocolScore {
    protocol: WorkProtocol;
    compatible: boolean;
    score: number; // 0-100
    reason: string;
}

export class ProtocolLatencyMatrix {
    private readonly PROTOCOL_REQUIREMENTS: Record<WorkProtocol, {
        needsUDP: boolean;
        needsLowLatency: boolean;
        maxNATStrictness: NATType[]
    }> = {
            [WorkProtocol.SSH]: { needsUDP: false, needsLowLatency: false, maxNATStrictness: [NATType.SYMMETRIC, NATType.UNKNOWN] },
            [WorkProtocol.WEBRTC_VOICE]: { needsUDP: true, needsLowLatency: true, maxNATStrictness: [NATType.PORT_RESTRICTED, NATType.RESTRICTED_CONE, NATType.FULL_CONE, NATType.OPEN] },
            [WorkProtocol.WEBRTC_VIDEO]: { needsUDP: true, needsLowLatency: true, maxNATStrictness: [NATType.FULL_CONE, NATType.OPEN] },
            [WorkProtocol.SIP]: { needsUDP: true, needsLowLatency: false, maxNATStrictness: [NATType.PORT_RESTRICTED, NATType.RESTRICTED_CONE, NATType.FULL_CONE, NATType.OPEN] },
            [WorkProtocol.RDP]: { needsUDP: false, needsLowLatency: true, maxNATStrictness: [NATType.SYMMETRIC, NATType.UNKNOWN] },
            [WorkProtocol.UDP_GAMING]: { needsUDP: true, needsLowLatency: true, maxNATStrictness: [NATType.FULL_CONE, NATType.OPEN] }
        };

    public generateMatrix(
        fingerprint: FingerprintResult,
        dnsLatencies: Record<string, { latency: number; resolved: boolean }>
    ): ProtocolScore[] {
        const scores: ProtocolScore[] = [];

        for (const [protocol, reqs] of Object.entries(this.PROTOCOL_REQUIREMENTS)) {
            const p = protocol as WorkProtocol;
            let score = 100;
            let compatible = true;
            let reason = 'Optimal conditions detected.';

            // Check UDP requirement
            if (reqs.needsUDP && fingerprint.udpBlocked) {
                compatible = false;
                score = 0;
                reason = 'UDP traffic is blocked by the venue firewall.';
            }

            // Check NAT strictness
            if (compatible && !reqs.maxNATStrictness.includes(fingerprint.natType)) {
                compatible = false;
                score = Math.max(score - 60, 0);
                reason = `NAT type (${fingerprint.natType}) is too restrictive for ${p}.`;
            }

            // Check latency (using average DNS/TCP proxy latency)
            if (compatible && reqs.needsLowLatency) {
                const avgLatency = this.calculateAverageLatency(dnsLatencies);
                if (avgLatency > 150) {
                    score -= 30;
                    reason = 'High latency detected. Voice/Video may experience jitter.';
                } else if (avgLatency > 80) {
                    score -= 10;
                    reason = 'Moderate latency detected.';
                }
            }

            // Check WebSocket support (critical for modern WebRTC signaling)
            if (!fingerprint.websocketsSupported) {
                score -= 20;
                if (p.startsWith('WEBRTC')) {
                    compatible = false;
                    reason = 'Secure WebSockets (WSS) are blocked. Signaling will fail.';
                }
            }

            scores.push({
                protocol: p,
                compatible,
                score: Math.max(0, Math.min(100, score)),
                reason
            });
        }

        return scores;
    }

    private calculateAverageLatency(latencies: Record<string, { latency: number; resolved: boolean }>): number {
        const valid = Object.values(latencies).filter(l => l.resolved && l.latency > 0);
        if (valid.length === 0) return 999;
        const sum = valid.reduce((acc, curr) => acc + curr.latency, 0);
        return sum / valid.length;
    }
}
