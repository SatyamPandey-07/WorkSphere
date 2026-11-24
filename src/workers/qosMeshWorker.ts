/**
 * Web Worker that intercepts network telemetry, calculates QoS penalties, 
 * and broadcasts throttle commands to offending peers.
 */

import { PacketTimingAnalyzer } from '../core/network/PacketTimingAnalyzer';
import { CooperativeQoSEngine, QoSPolicy } from '../core/network/CooperativeQoSEngine';

export const analyzer = new PacketTimingAnalyzer();
export let qosEngine: CooperativeQoSEngine | null = null;
let evaluationInterval: number | null = null;

export function handleWorkerMessage(event: { data: { type: string; payload?: any } }) {
    const { type, payload } = event.data || {};

    switch (type) {
        case 'INIT': {
            const policy: QoSPolicy = payload?.policy || {
                maxBandwidthBps: 50000000, // 50 Mbps
                voipReserveBps: 5000000,   // 5 Mbps
                fairShareFactor: 0.8,
            };
            qosEngine = new CooperativeQoSEngine(policy);

            // Run QoS evaluation every 1 second
            if (typeof self !== 'undefined' && typeof self.setInterval === 'function') {
                evaluationInterval = self.setInterval(evaluateMesh, 1000) as unknown as number;
            }
            break;
        }

        case 'PEER_JOINED':
            if (payload?.peerId) {
                analyzer.registerPeer(payload.peerId);
                qosEngine?.addPeer(payload.peerId);
            }
            break;

        case 'PEER_LEFT':
            if (payload?.peerId) {
                analyzer.removePeer(payload.peerId);
                qosEngine?.removePeer(payload.peerId);
            }
            break;

        case 'TELEMETRY_UPDATE': {
            const { peerId, rtt, ackDelay, bytesPerSec } = payload || {};
            if (!peerId || !analyzer.hasPeer(peerId)) {
                break;
            }
            if (typeof rtt === 'number') analyzer.recordRTT(peerId, rtt);
            if (typeof ackDelay === 'number') analyzer.recordACKDelay(peerId, ackDelay);
            if (typeof bytesPerSec === 'number') analyzer.updateBandwidth(peerId, bytesPerSec);
            break;
        }
    }
}

export function evaluateMesh() {
    if (!qosEngine) return;

    const hogId = analyzer.identifyHog();

    if (hogId && analyzer.hasPeer(hogId)) {
        // Apply a 50% throttle to the offending peer
        qosEngine.penalizePeer(hogId, 0.5);

        if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
            self.postMessage({
                type: 'THROTTLE_APPLIED',
                payload: { peerId: hogId, metrics: analyzer.getMetrics() }
            });
        }
    } else {
        // Restore all peers to fair share if no hog is detected
        const metrics = analyzer.getMetrics();
        metrics.forEach(m => {
            if (m.isHog && analyzer.hasPeer(m.peerId)) { // Was previously a hog
                qosEngine!.restorePeer(m.peerId);
            }
        });
    }
}

if (typeof self !== 'undefined') {
    self.onmessage = handleWorkerMessage as any;
}
