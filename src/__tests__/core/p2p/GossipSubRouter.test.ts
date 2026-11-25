import {
  GossipSubRouter,
  PacketPriority,
  type DataChannelLike,
} from '@/core/p2p/GossipSubRouter';

describe('GossipSubRouter priority queue, TTL expiry, and DataChannel backpressure', () => {
  it('preempts queued telemetry with EMERGENCY beacons during 90% channel saturation', () => {
    let clock = 1_000;
    const router = new GossipSubRouter({
      maxQueueSize: 32,
      now: () => clock,
    });

    for (let i = 0; i < 10; i++) {
      router.enqueue({
        id: `telem-${i}`,
        topic: 'nomad.telemetry',
        priority: PacketPriority.TELEMETRY,
        payload: { seq: i },
        ttlMs: 10_000,
      });
    }

    router.enqueue({
      id: 'sos-beacon-1',
      topic: 'nomad.sos',
      priority: PacketPriority.EMERGENCY,
      payload: { sos: true },
      ttlMs: 20_000,
    });

    const sentPayloadIds: string[] = [];
    const saturatedChannel: DataChannelLike = {
      readyState: 'open',
      bufferedAmount: 920_000,
      maxBufferedAmount: 1_048_576,
      send(data) {
        const parsed = JSON.parse(String(data)) as { id: string };
        sentPayloadIds.push(parsed.id);
      },
    };

    const flushed = router.flushToChannel(saturatedChannel);
    expect(flushed.map((p) => p.id)).toEqual(['sos-beacon-1']);
    expect(sentPayloadIds).toEqual(['sos-beacon-1']);
  });

  it('garbage collects expired packets based on TTL without retaining them', () => {
    let clock = 5_000;
    const router = new GossipSubRouter({
      now: () => clock,
    });

    router.enqueue({
      id: 'stale-telemetry',
      topic: 'nomad.telemetry',
      priority: PacketPriority.TELEMETRY,
      payload: { temp: 29 },
      ttlMs: 500,
    });

    router.enqueue({
      id: 'fresh-alert',
      topic: 'nomad.alert',
      priority: PacketPriority.SAFETY_ALERT,
      payload: { alert: 'hazard' },
      ttlMs: 5_000,
    });

    clock += 600;
    const next = router.dequeue();
    expect(next?.id).toBe('fresh-alert');
    expect(router.size()).toBe(0);
    expect(router.getMetrics().expiredCount).toBe(1);
  });
});