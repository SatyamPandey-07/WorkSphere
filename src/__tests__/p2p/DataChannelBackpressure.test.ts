/**
 * @jest-environment node
 */
import {
  GossipSubRouter,
  generateEd25519Identity,
} from '@/core/p2p/GossipSubRouter';
import {
  decodePacket,
  encodePacket,
  MeshPacketType,
  PublishPacket,
} from '@/core/p2p/MeshPacketSerializer';

// Mock RTCDataChannel helper
class MockRTCDataChannel {
  binaryType: 'blob' | 'arraybuffer' = 'arraybuffer';
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  private listeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: { type: string }): boolean {
    const list = this.listeners.get(event.type);
    if (list) {
      for (const listener of list) {
        if (typeof listener === 'function') {
          listener(event as unknown as Event);
        } else if (listener && typeof listener.handleEvent === 'function') {
          listener.handleEvent(event as unknown as Event);
        }
      }
    }
    return true;
  }

  simulateDrain(newBufferedAmount: number): void {
    this.bufferedAmount = newBufferedAmount;
    if (this.bufferedAmount <= this.bufferedAmountLowThreshold) {
      this.dispatchEvent({ type: 'bufferedamountlow' });
    }
  }

  close(): void {
    this.readyState = 'closed';
    this.dispatchEvent({ type: 'close' });
  }
}

describe('WebRTC DataChannel Backpressure Fix (#8906)', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('honors highWatermark and pauses transmission when buffer exceeds limit', async () => {
    const mockChannel = new MockRTCDataChannel();
    mockChannel.bufferedAmount = 300 * 1024; // Exceeds 256KB default highWatermark
    const sentBytes: Uint8Array[] = [];
    const backpressureEvents: boolean[] = [];

    const router = new GossipSubRouter({
      localPeerId: 'peer-sender',
      identity: await generateEd25519Identity(),
      getDataChannel: (peerId) => (peerId === 'peer-receiver' ? (mockChannel as unknown as RTCDataChannel) : null),
      backpressure: {
        highWatermark: 256 * 1024,
        lowWatermark: 64 * 1024,
        onBackpressureChange: (p, isBp) => backpressureEvents.push(isBp),
      },
      send: (to, data) => {
        sentBytes.push(data);
      },
    });

    router.addPeer('peer-receiver');
    router.subscribe('crdt/draw');

    // Graft receiver to establish mesh
    const graftPacket = encodePacket({
      type: MeshPacketType.Graft,
      topic: 'crdt/draw',
    });
    await router.handlePacket('peer-receiver', graftPacket);

    // Publish a burst of 5 CRDT draw frames
    for (let i = 0; i < 5; i++) {
      await router.publish('crdt/draw', enc(`crdt-frame-${i}`));
    }

    // Sender should recognize channel is over high watermark and buffer in queue
    const queueInfo = router.getPeerQueueInfo('peer-receiver');
    expect(queueInfo.queuedPackets).toBeGreaterThan(0);
    expect(queueInfo.isBackpressured).toBe(true);
    expect(backpressureEvents).toContain(true);
    // Only control packet (Subscribe) was sent before graft/publish, 0 publish packets sent yet
    const publishSent = sentBytes.filter((b) => decodePacket(b).type === MeshPacketType.Publish);
    expect(publishSent.length).toBe(0);

    // Simulate drain below low watermark
    mockChannel.simulateDrain(32 * 1024);

    // Wait for queue flush
    await router.flush('peer-receiver');

    const updatedQueueInfo = router.getPeerQueueInfo('peer-receiver');
    expect(updatedQueueInfo.queuedPackets).toBe(0);
    expect(updatedQueueInfo.isBackpressured).toBe(false);
    const publishSentAfter = sentBytes.filter((b) => decodePacket(b).type === MeshPacketType.Publish);
    expect(publishSentAfter.length).toBe(5);

    router.destroy();
  });

  it('preserves strict FIFO sequential ordering across backpressure drain', async () => {
    const mockChannel = new MockRTCDataChannel();
    mockChannel.bufferedAmount = 400 * 1024; // Backpressured
    const receivedFrames: string[] = [];

    const router = new GossipSubRouter({
      localPeerId: 'node-A',
      identity: await generateEd25519Identity(),
      getDataChannel: () => mockChannel as unknown as RTCDataChannel,
      backpressure: {
        highWatermark: 256 * 1024,
        lowWatermark: 64 * 1024,
      },
      send: (to, data) => {
        const decoded = decodePacket(data) as PublishPacket;
        if (decoded.type === MeshPacketType.Publish) {
          receivedFrames.push(new TextDecoder().decode(decoded.payload));
        }
      },
    });

    router.addPeer('node-B');
    router.subscribe('crdt/type');
    await router.handlePacket(
      'node-B',
      encodePacket({ type: MeshPacketType.Graft, topic: 'crdt/type' })
    );

    // Enqueue 20 sequential character insertions
    for (let i = 0; i < 20; i++) {
      await router.publish('crdt/type', enc(`char-op-${i}`));
    }

    // Currently stalled due to backpressure
    expect(receivedFrames.length).toBe(0);

    // Drain buffer
    mockChannel.simulateDrain(10 * 1024);
    await router.flush('node-B');

    // Confirm strict sequential delivery
    expect(receivedFrames.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(receivedFrames[i]).toBe(`char-op-${i}`);
    }

    router.destroy();
  });

  it('handles WebRTC OperationError by requeuing and awaiting drain without data loss', async () => {
    const mockChannel = new MockRTCDataChannel();
    mockChannel.bufferedAmount = 10 * 1024; // Initially under watermark
    let throwCount = 2;
    const deliveredFrames: string[] = [];

    const router = new GossipSubRouter({
      localPeerId: 'source-node',
      identity: await generateEd25519Identity(),
      getDataChannel: () => mockChannel as unknown as RTCDataChannel,
      backpressure: {
        highWatermark: 256 * 1024,
        lowWatermark: 64 * 1024,
      },
      send: (to, data) => {
        const decoded = decodePacket(data);
        if (decoded.type === MeshPacketType.Publish && throwCount > 0) {
          throwCount--;
          mockChannel.bufferedAmount = 500 * 1024; // Spike buffer
          const opError = new Error('RTCDataChannel send queue is full');
          opError.name = 'OperationError';
          // Schedule simulation of drain shortly after OperationError
          setTimeout(() => {
            mockChannel.simulateDrain(20 * 1024);
          }, 30);
          throw opError;
        }
        if (decoded.type === MeshPacketType.Publish) {
          deliveredFrames.push(new TextDecoder().decode(decoded.payload));
        }
      },
    });

    router.addPeer('dest-node');
    router.subscribe('crdt/stream');
    await router.handlePacket(
      'dest-node',
      encodePacket({ type: MeshPacketType.Graft, topic: 'crdt/stream' })
    );

    // Publish CRDT operation
    await router.publish('crdt/stream', enc('critical-crdt-mutation'));

    await router.flush('dest-node');

    // Message should not be lost despite 2 OperationErrors
    expect(deliveredFrames).toEqual(['critical-crdt-mutation']);
    expect(throwCount).toBe(0);

    router.destroy();
  });

  it('rejects / drops packets on bounded queue overflow to protect browser memory', async () => {
    const mockChannel = new MockRTCDataChannel();
    mockChannel.bufferedAmount = 500 * 1024; // Stalled
    const droppedEvents: Array<{ peerId: string; bytes: number; reason: string }> = [];

    const router = new GossipSubRouter({
      localPeerId: 'burst-node',
      identity: await generateEd25519Identity(),
      getDataChannel: () => mockChannel as unknown as RTCDataChannel,
      backpressure: {
        highWatermark: 100 * 1024,
        lowWatermark: 20 * 1024,
        maxQueuePackets: 5, // Small queue limit for test
        maxQueueBytes: 100_000,
        onPacketDropped: (peerId, bytes, reason) => {
          droppedEvents.push({ peerId, bytes, reason });
        },
      },
      send: () => {},
    });

    router.addPeer('slow-peer');
    router.subscribe('crdt/rapid');
    await router.handlePacket(
      'slow-peer',
      encodePacket({ type: MeshPacketType.Graft, topic: 'crdt/rapid' })
    );

    // Initial state after subscribe control packet was sent
    const initialDropped = droppedEvents.length;
    const initialQueued = router.getPeerQueueInfo('slow-peer').queuedPackets;

    // Send 10 rapid packets; maxQueuePackets is 5
    for (let i = 0; i < 10; i++) {
      await router.publish('crdt/rapid', enc(`rapid-frame-${i}`));
    }

    const queueInfo = router.getPeerQueueInfo('slow-peer');
    expect(queueInfo.queuedPackets).toBe(5);
    // Since 1 control packet was already queued, 4 new packets were queued, and 6 were dropped
    expect(droppedEvents.length - initialDropped).toBe(6);

    router.destroy();
  });

  it('aborts drain gracefully when DataChannel closes or peer is removed', async () => {
    const mockChannel = new MockRTCDataChannel();
    mockChannel.bufferedAmount = 500 * 1024; // Stalled

    const router = new GossipSubRouter({
      localPeerId: 'abort-test',
      identity: await generateEd25519Identity(),
      getDataChannel: () => mockChannel as unknown as RTCDataChannel,
      send: () => {},
    });

    router.addPeer('peer-closed');
    router.subscribe('test/topic');
    await router.handlePacket(
      'peer-closed',
      encodePacket({ type: MeshPacketType.Graft, topic: 'test/topic' })
    );

    await router.publish('test/topic', enc('never-sent'));

    const flushPromise = router.flush('peer-closed');

    // Remove peer or close channel
    router.removePeer('peer-closed');

    // flush should reject cleanly with peer removed error
    await expect(flushPromise).rejects.toThrow('Peer peer-closed removed from router');

    router.destroy();
  });

  it('provides explicit producer failure via QueueOverflowError when overflowPolicy is "throw"', async () => {
    const mockChannel = new MockRTCDataChannel();
    mockChannel.bufferedAmount = 500 * 1024; // Stalled

    const router = new GossipSubRouter({
      localPeerId: 'throw-node',
      identity: await generateEd25519Identity(),
      getDataChannel: () => mockChannel as unknown as RTCDataChannel,
      backpressure: {
        highWatermark: 100 * 1024,
        lowWatermark: 20 * 1024,
        maxQueuePackets: 2,
        overflowPolicy: 'throw',
      },
      send: () => {},
    });

    router.addPeer('target-peer');
    router.subscribe('crdt/strict');
    await router.handlePacket(
      'target-peer',
      encodePacket({ type: MeshPacketType.Graft, topic: 'crdt/strict' })
    );

    // After subscribe control packet (1 packet queued), 1 publish should succeed
    await router.publish('crdt/strict', enc('packet-1'));

    // Next packet exceeds maxQueuePackets (2) and throws QueueOverflowError
    await expect(
      router.publish('crdt/strict', enc('packet-2'))
    ).rejects.toThrow('Queue overflow');

    router.destroy();
  });

  it('blocks peer queue on retry exhaustion, preventing subsequent packets from bypassing failed entry', async () => {
    const mockChannel = new MockRTCDataChannel();
    mockChannel.bufferedAmount = 10 * 1024;
    const sentPublishPackets: string[] = [];
    let blockedEvents = 0;

    const router = new GossipSubRouter({
      localPeerId: 'exhaust-node',
      identity: await generateEd25519Identity(),
      getDataChannel: () => mockChannel as unknown as RTCDataChannel,
      backpressure: {
        highWatermark: 256 * 1024,
        lowWatermark: 64 * 1024,
        onQueueBlocked: () => {
          blockedEvents++;
        },
      },
      send: (to, data) => {
        const decoded = decodePacket(data);
        if (decoded.type === MeshPacketType.Publish) {
          const payloadStr = new TextDecoder().decode(decoded.payload);
          if (payloadStr === 'packet-A') {
            const opErr = new Error('Socket OperationError on packet-A');
            opErr.name = 'OperationError';
            // Allow retry loop to progress by draining mock buffer
            setTimeout(() => mockChannel.simulateDrain(10 * 1024), 5);
            throw opErr;
          }
          sentPublishPackets.push(payloadStr);
        }
      },
    });

    router.addPeer('target-peer');
    router.subscribe('crdt/ordering');
    await router.handlePacket(
      'target-peer',
      encodePacket({ type: MeshPacketType.Graft, topic: 'crdt/ordering' })
    );

    // Enqueue packet-A (which fails) and subsequent packet-B
    await router.publish('crdt/ordering', enc('packet-A'));
    await router.publish('crdt/ordering', enc('packet-B'));

    // flush should reject because peer's queue is blocked due to retry exhaustion
    await expect(router.flush('target-peer')).rejects.toThrow(
      'OperationError retry limit (5) exceeded'
    );

    const queueInfo = router.getPeerQueueInfo('target-peer');
    expect(queueInfo.isBlocked).toBe(true);
    expect(blockedEvents).toBe(1);

    // Crucial check: packet-B MUST NOT bypass packet-A and get sent
    expect(sentPublishPackets).toEqual([]);

    // Enqueueing a new packet-C also fails/is rejected without being sent
    expect(router.enqueueSend('target-peer', enc('packet-C'))).toBe(false);
    expect(sentPublishPackets).toEqual([]);

    // Explicit recovery mechanism: resetPeerQueue allows clean state reset
    router.resetPeerQueue('target-peer');
    const resetQueueInfo = router.getPeerQueueInfo('target-peer');
    expect(resetQueueInfo.isBlocked).toBe(false);
    expect(resetQueueInfo.queuedPackets).toBe(0);

    router.destroy();
  });

  it('handles dynamic channel transitions (missing -> connecting -> open -> closed)', async () => {
    let activeChannel: MockRTCDataChannel | null = null;
    const deliveredFrames: string[] = [];

    const router = new GossipSubRouter({
      localPeerId: 'lifecycle-node',
      identity: await generateEd25519Identity(),
      getDataChannel: () => activeChannel as unknown as RTCDataChannel,
      backpressure: {
        highWatermark: 200 * 1024,
        lowWatermark: 50 * 1024,
      },
      send: (to, data) => {
        const decoded = decodePacket(data);
        if (decoded.type === MeshPacketType.Publish) {
          deliveredFrames.push(new TextDecoder().decode(decoded.payload));
        }
      },
    });

    router.addPeer('dynamic-peer');
    router.subscribe('crdt/lifecycle');
    await router.handlePacket(
      'dynamic-peer',
      encodePacket({ type: MeshPacketType.Graft, topic: 'crdt/lifecycle' })
    );

    // 1. Channel is initially null/missing: router sends through transport fallback
    await router.publish('crdt/lifecycle', enc('frame-while-null'));
    await router.flush('dynamic-peer');
    expect(deliveredFrames).toContain('frame-while-null');

    // 2. Channel appears in 'connecting' state, then transitions to 'open'
    const newChannel = new MockRTCDataChannel();
    newChannel.readyState = 'connecting';
    activeChannel = newChannel;

    // Enqueue message while connecting
    const publishPromise = router.publish('crdt/lifecycle', enc('frame-while-connecting'));

    // Let it yield, then transition channel to open
    setTimeout(() => {
      newChannel.readyState = 'open';
    }, 40);

    await publishPromise;
    await router.flush('dynamic-peer');
    expect(deliveredFrames).toContain('frame-while-connecting');

    // 3. Channel transitions to 'closed'
    newChannel.close();
    // Subsequent queue operations to closed peer fail safely
    router.removePeer('dynamic-peer');
    router.destroy();
  });
});
