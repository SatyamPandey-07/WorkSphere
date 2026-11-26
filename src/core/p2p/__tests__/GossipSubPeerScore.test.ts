import { GossipSubPeerScore } from '../GossipSubPeerScore';
import { GossipSubRouter } from '../GossipSubRouter';

describe('GossipSubPeerScore & GossipSubRouter IP-colocation defense', () => {
  it('applies quadratic penalties as multiple phantom peers share a /24 subnet', () => {
    const scorer = new GossipSubPeerScore({
      subnetGracePeers: 1,
      subnetPenaltyWeight: 4,
      pruneThreshold: -30,
    });

    scorer.registerPeer('peer-1', '10.0.1.10');
    expect(scorer.getScore('peer-1').colocationPenalty).toBe(0);

    scorer.registerPeer('peer-2', '10.0.1.11');
    expect(scorer.getScore('peer-2').colocationPenalty).toBe(4);

    scorer.registerPeer('peer-3', '10.0.1.12');
    expect(scorer.getScore('peer-3').colocationPenalty).toBe(16);

    scorer.registerPeer('peer-4', '10.0.1.13');
    const snap4 = scorer.getScore('peer-4');
    expect(snap4.colocationPenalty).toBe(36);
    expect(snap4.totalScore).toBe(-36);
    expect(snap4.disposition).toBe('PRUNED');
  });

  it('deprioritizes and prunes messages in GossipSubRouter based on peer score', () => {
    const router = new GossipSubRouter({
      subnetGracePeers: 1,
      subnetPenaltyWeight: 5,
      deprioritizeThreshold: -5,
      pruneThreshold: -20,
    });

    router.onPeerConnect('legit-peer', '192.168.50.2');
    router.onPeerConnect('sybil-1', '198.51.100.10');
    router.onPeerConnect('sybil-2', '198.51.100.11');
    router.onPeerConnect('sybil-3', '198.51.100.12');
    router.onPeerConnect('sybil-4', '198.51.100.13');

    const deprioritizedRes = router.handleIncomingMessage({
      id: 'm-dep',
      topic: 'alerts',
      fromPeerId: 'sybil-3',
      payload: { ping: 1 },
    });
    expect(deprioritizedRes.accepted).toBe(true);
    expect(deprioritizedRes.priority).toBe('LOW');

    const prunedRes = router.handleIncomingMessage({
      id: 'm-prune',
      topic: 'alerts',
      fromPeerId: 'sybil-4',
      payload: { flood: true },
    });
    expect(prunedRes.accepted).toBe(false);
    expect(prunedRes.priority).toBe('DROPPED');

    const healthyRes = router.handleIncomingMessage({
      id: 'm-high',
      topic: 'alerts',
      fromPeerId: 'legit-peer',
      payload: { sos: false },
    });
    expect(healthyRes.accepted).toBe(true);
    expect(healthyRes.priority).toBe('HIGH');

    expect(router.drainNextMessage()?.id).toBe('m-high');
    expect(router.drainNextMessage()?.id).toBe('m-dep');
    expect(router.drainNextMessage()).toBeUndefined();
  });
});