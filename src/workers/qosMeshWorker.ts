/**
 * Web Worker that intercepts network telemetry, calculates QoS penalties, 
 * and broadcasts throttle commands to offending peers.
 */

import { PacketTimingAnalyzer } from '../core/network/PacketTimingAnalyzer';
import { CooperativeQoSEngine, QoSPolicy } from '../core/network/CooperativeQoSEngine';

const analyzer = new PacketTimingAnalyzer();
let qosEngine: CooperativeQoSEngine | null = null;
let evaluationInterval: number | null = null;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT':
            const policy: QoSPolicy = payload.policy || {
                maxBandwidthBps: 50000000, // 50 Mbps
                voipReserveBps: 5000000,   // 5 Mbps
                fairShareFactor: 0.8,
            };
            qosEngine = new CooperativeQoSEngine(policy);

            // Run QoS evaluation every 1 second
            evaluationInterval = self.setInterval(evaluateMesh, 1000) as unknown as number;
            break;

        case 'PEER_JOINED':
            analyzer.registerPeer(payload.peerId);
            qosEngine?.addPeer(payload.peerId);
            break;

        case 'PEER_LEFT':
            qosEngine?.removePeer(payload.peerId);
            break;

        case 'TELEMETRY_UPDATE':
            const { peerId, rtt, ackDelay, bytesPerSec } = payload;
            analyzer.recordRTT(peerId, rtt);
            analyzer.recordACKDelay(peerId, ackDelay);
            analyzer.updateBandwidth(peerId, bytesPerSec);
            break;
    }
};

function evaluateMesh() {
    if (!qosEngine) return;

    const hogId = analyzer.identifyHog();

    if (hogId) {
        // Apply a 50% throttle to the offending peer
        qosEngine.penalizePeer(hogId, 0.5);

        self.postMessage({
            type: 'THROTTLE_APPLIED',
            payload: { peerId: hogId, metrics: analyzer.getMetrics() }
        });
    } else {
        // Restore all peers to fair share if no hog is detected
        const metrics = analyzer.getMetrics();
        metrics.forEach(m => {
            if (m.isHog) { // Was previously a hog
                qosEngine!.restorePeer(m.peerId);
            }
        });
    }
}
