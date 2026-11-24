import { CooperativeQoSEngine, QoSPolicy } from '@/core/network/CooperativeQoSEngine';
import { PacketTimingAnalyzer } from '@/core/network/PacketTimingAnalyzer';
import {
  analyzer,
  handleWorkerMessage,
  qosEngine,
  evaluateMesh,
} from '@/workers/qosMeshWorker';

describe('Cooperative QoS Peer State Cleanup & Active Accounting (#10077)', () => {
  const defaultPolicy: QoSPolicy = {
    maxBandwidthBps: 50_000_000, // 50 Mbps
    voipReserveBps: 5_000_000, // 5 Mbps
    fairShareFactor: 0.8,
  };

  describe('PacketTimingAnalyzer peer removal and metrics cleanup', () => {
    let analyzerInstance: PacketTimingAnalyzer;

    beforeEach(() => {
      analyzerInstance = new PacketTimingAnalyzer();
    });

    it('removes departed peers and excludes them from getMetrics()', () => {
      analyzerInstance.registerPeer('peer-1');
      analyzerInstance.registerPeer('peer-2');

      expect(analyzerInstance.hasPeer('peer-1')).toBe(true);
      expect(analyzerInstance.hasPeer('peer-2')).toBe(true);
      expect(analyzerInstance.getMetrics()).toHaveLength(2);

      analyzerInstance.removePeer('peer-1');

      expect(analyzerInstance.hasPeer('peer-1')).toBe(false);
      expect(analyzerInstance.hasPeer('peer-2')).toBe(true);

      const metrics = analyzerInstance.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].peerId).toBe('peer-2');
    });

    it('ignores telemetry updates for unregister / departed peers', () => {
      analyzerInstance.registerPeer('peer-1');
      analyzerInstance.recordRTT('peer-1', 45);
      analyzerInstance.recordACKDelay('peer-1', 12);
      analyzerInstance.updateBandwidth('peer-1', 250_000);

      // Now remove peer-1
      analyzerInstance.removePeer('peer-1');

      // Attempt late telemetry updates
      analyzerInstance.recordRTT('peer-1', 120);
      analyzerInstance.recordACKDelay('peer-1', 80);
      analyzerInstance.updateBandwidth('peer-1', 500_000);

      // Re-register peer-1 fresh
      analyzerInstance.registerPeer('peer-1');
      const freshMetrics = analyzerInstance.getMetrics().find((m) => m.peerId === 'peer-1');

      expect(freshMetrics).toBeDefined();
      expect(freshMetrics?.rttHistory).toEqual([]);
      expect(freshMetrics?.ackDelayHistory).toEqual([]);
      expect(freshMetrics?.bytesSentPerSec).toBe(0);
    });

    it('prevents departed peers from influencing bandwidth hog detection', () => {
      analyzerInstance.registerPeer('peer-1');
      analyzerInstance.registerPeer('peer-2');
      analyzerInstance.registerPeer('departed-hog');

      // Populate ACK delay histories with low jitter for normal peers, high for hog
      for (let i = 0; i < 10; i++) {
        analyzerInstance.recordACKDelay('peer-1', 10);
        analyzerInstance.recordACKDelay('peer-2', 10);
        analyzerInstance.recordACKDelay('departed-hog', i % 2 === 0 ? 10 : 200); // Massive variance
      }
      analyzerInstance.updateBandwidth('peer-1', 50_000);
      analyzerInstance.updateBandwidth('peer-2', 50_000);
      analyzerInstance.updateBandwidth('departed-hog', 2_000_000);

      // Before removal, departed-hog is identified as hog
      expect(analyzerInstance.identifyHog()).toBe('departed-hog');

      // Remove the hog peer when it disconnects
      analyzerInstance.removePeer('departed-hog');

      // Now hog detection should not return the departed peer
      expect(analyzerInstance.identifyHog()).toBeNull();
    });
  });

  describe('CooperativeQoSEngine active-peer accounting and fair-share calculations', () => {
    let engine: CooperativeQoSEngine;

    beforeEach(() => {
      engine = new CooperativeQoSEngine(defaultPolicy);
    });

    it('does not inflate activePeers when a peer leaves before creating a token bucket', () => {
      engine.addPeer('peer-no-bucket');
      expect(engine.getActivePeers()).toBe(1);
      expect(engine.activePeers).toBe(1);

      // Disconnect immediately without sending any non-priority packet
      engine.removePeer('peer-no-bucket');

      expect(engine.getActivePeers()).toBe(0);
      expect(engine.activePeers).toBe(0);
    });

    it('handles priority-only peers without inflating activePeers after departure', () => {
      engine.addPeer('voip-peer');
      expect(engine.getActivePeers()).toBe(1);

      // VoIP packets bypass token bucket
      const allowed = engine.allowPacket('voip-peer', 500, true);
      expect(allowed).toBe(true);

      // Peer disconnects
      engine.removePeer('voip-peer');
      expect(engine.getActivePeers()).toBe(0);
      expect(engine.activePeers).toBe(0);
    });

    it('guarantees idempotency on repeated join and leave calls', () => {
      // Multiple joins for the same peer
      engine.addPeer('peer-A');
      engine.addPeer('peer-A');
      engine.addPeer('peer-A');
      expect(engine.getActivePeers()).toBe(1);

      engine.addPeer('peer-B');
      expect(engine.getActivePeers()).toBe(2);

      // Multiple leaves for peer-A
      engine.removePeer('peer-A');
      engine.removePeer('peer-A');
      expect(engine.getActivePeers()).toBe(1);
      expect(engine.hasPeer('peer-A')).toBe(false);
      expect(engine.hasPeer('peer-B')).toBe(true);

      // Leave peer-B
      engine.removePeer('peer-B');
      engine.removePeer('peer-B');
      expect(engine.getActivePeers()).toBe(0);
      expect(engine.activePeers).toBe(0);
    });

    it('recalculates fair-share limits correctly when peers join and depart', () => {
      // Available bandwidth: 50 Mbps - 5 Mbps = 45 Mbps * 0.8 = 36 Mbps total fair share
      // 1 peer: 36 Mbps
      engine.addPeer('peer-1');
      expect(engine.getFairShareRate()).toBe(36_000_000);

      // 2 peers: 18 Mbps each
      engine.addPeer('peer-2');
      expect(engine.getFairShareRate()).toBe(18_000_000);

      // 3 peers: 12 Mbps each
      engine.addPeer('peer-3');
      expect(engine.getFairShareRate()).toBe(12_000_000);

      // Peer 2 departs: remaining 2 peers get 18 Mbps each
      engine.removePeer('peer-2');
      expect(engine.getActivePeers()).toBe(2);
      expect(engine.getFairShareRate()).toBe(18_000_000);

      // Peer 1 and 3 depart: 0 peers resets rate to full capacity
      engine.removePeer('peer-1');
      engine.removePeer('peer-3');
      expect(engine.getActivePeers()).toBe(0);
      expect(engine.getFairShareRate()).toBe(defaultPolicy.maxBandwidthBps);
    });

    it('rejects non-priority packets from departed peers without recreating buckets', () => {
      engine.addPeer('peer-1');
      expect(engine.allowPacket('peer-1', 1000, false)).toBe(true);

      engine.removePeer('peer-1');
      expect(engine.allowPacket('peer-1', 1000, false)).toBe(false);
      expect(engine.getActivePeers()).toBe(0);
    });
  });

  describe('qosMeshWorker message handling integration', () => {
    beforeEach(() => {
      handleWorkerMessage({
        data: {
          type: 'INIT',
          payload: { policy: defaultPolicy },
        },
      });
    });

    it('cleans up both qosEngine and analyzer on PEER_LEFT', () => {
      handleWorkerMessage({
        data: {
          type: 'PEER_JOINED',
          payload: { peerId: 'worker-peer-1' },
        },
      });

      expect(analyzer.hasPeer('worker-peer-1')).toBe(true);
      expect(qosEngine?.hasPeer('worker-peer-1')).toBe(true);
      expect(qosEngine?.activePeers).toBe(1);

      handleWorkerMessage({
        data: {
          type: 'PEER_LEFT',
          payload: { peerId: 'worker-peer-1' },
        },
      });

      expect(analyzer.hasPeer('worker-peer-1')).toBe(false);
      expect(qosEngine?.hasPeer('worker-peer-1')).toBe(false);
      expect(qosEngine?.activePeers).toBe(0);
      expect(analyzer.getMetrics().some((m) => m.peerId === 'worker-peer-1')).toBe(false);
    });

    it('ignores TELEMETRY_UPDATE for departed peers in worker', () => {
      handleWorkerMessage({
        data: {
          type: 'PEER_JOINED',
          payload: { peerId: 'worker-peer-2' },
        },
      });

      handleWorkerMessage({
        data: {
          type: 'PEER_LEFT',
          payload: { peerId: 'worker-peer-2' },
        },
      });

      // Late telemetry message sent by network socket
      handleWorkerMessage({
        data: {
          type: 'TELEMETRY_UPDATE',
          payload: {
            peerId: 'worker-peer-2',
            rtt: 80,
            ackDelay: 25,
            bytesPerSec: 100_000,
          },
        },
      });

      expect(analyzer.hasPeer('worker-peer-2')).toBe(false);
      expect(analyzer.getMetrics().some((m) => m.peerId === 'worker-peer-2')).toBe(false);
    });
  });
});
