import {
  DTNBundleProtocol,
  Bundle,
  BundlePriority,
  BundleExpirationEvent,
} from '@/core/network/DTNBundleProtocol';
import { BLEMeshRouter } from '@/core/network/BLEMeshRouter';

describe('DTNBundleProtocol Bundle Expiration and Purge (#5602)', () => {
  let protocol: DTNBundleProtocol;

  beforeEach(() => {
    jest.useFakeTimers();
    // Initialize without background interval for deterministic tick testing
    protocol = new DTNBundleProtocol(244, 0);
  });

  afterEach(() => {
    protocol.stopSweepInterval();
    jest.useRealTimers();
  });

  it('stores bundles and purges expired bundles after lifetime elapses', () => {
    const payload = new TextEncoder().encode('Hello venue peer');
    const lifetimeMs = 5000; // 5 seconds
    const bundles = protocol.createBundle(
      'dtn://worksphere/user-alice',
      'dtn://worksphere/venue-123/desk',
      payload,
      lifetimeMs,
      BundlePriority.NORMAL
    );

    expect(bundles.length).toBe(1);
    protocol.storeBundle(bundles[0]);

    expect(protocol.getStoredBundleCount()).toBe(1);
    expect(protocol.getStoredBundles().length).toBe(1);

    // Fast-forward time by 3 seconds (not yet expired)
    jest.advanceTimersByTime(3000);
    expect(protocol.getStoredBundleCount()).toBe(1);

    // Fast-forward time past 5 seconds (expired)
    jest.advanceTimersByTime(2500);

    const purged = protocol.purgeExpiredBundles();
    expect(purged.length).toBe(1);
    expect(protocol.getStoredBundleCount()).toBe(0);
    expect(protocol.getStoredBundles().length).toBe(0);
  });

  it('emits bundle expiration telemetry event when bundle expires', () => {
    const payload = new TextEncoder().encode('Urgent booking update');
    const lifetimeMs = 2000;
    const bundles = protocol.createBundle(
      'dtn://worksphere/user-bob',
      'dtn://worksphere/gateway',
      payload,
      lifetimeMs,
      BundlePriority.EXPEDITED
    );

    const expiredEvents: BundleExpirationEvent[] = [];
    const unsubscribe = protocol.onBundleExpired((event) => {
      expiredEvents.push(event);
    });

    protocol.storeBundle(bundles[0]);
    expect(expiredEvents.length).toBe(0);

    // Advance beyond lifetime
    jest.advanceTimersByTime(3000);
    protocol.purgeExpiredBundles();

    expect(expiredEvents.length).toBe(1);
    expect(expiredEvents[0].source).toBe('dtn://worksphere/user-bob');
    expect(expiredEvents[0].destination).toBe('dtn://worksphere/gateway');
    expect(expiredEvents[0].lifetime).toBe(2000);
    expect(expiredEvents[0].bundleId).toBeDefined();

    unsubscribe();
  });

  it('automatically purges expired bundles on storeBundle insert', () => {
    const payloadA = new TextEncoder().encode('Message A');
    const bundlesA = protocol.createBundle(
      'dtn://worksphere/user-1',
      'dtn://worksphere/venue',
      payloadA,
      1000 // 1 second lifetime
    );
    protocol.storeBundle(bundlesA[0]);
    expect(protocol.getStoredBundleCount()).toBe(1);

    // Advance time so bundle A expires
    jest.advanceTimersByTime(1500);

    // Store bundle B with longer lifetime; should automatically purge bundle A
    const payloadB = new TextEncoder().encode('Message B');
    const bundlesB = protocol.createBundle(
      'dtn://worksphere/user-2',
      'dtn://worksphere/venue',
      payloadB,
      10000
    );
    protocol.storeBundle(bundlesB[0]);

    expect(protocol.getStoredBundleCount()).toBe(1);
    const stored = protocol.getStoredBundles();
    expect(stored[0].header.source).toBe('dtn://worksphere/user-2');
  });

  it('automatically purges bundles on periodic interval sweep tick', () => {
    const autoProtocol = new DTNBundleProtocol(244, 500); // interval tick every 500ms
    const payload = new TextEncoder().encode('Ephemeral telemetry');
    const bundles = autoProtocol.createBundle(
      'dtn://worksphere/sensor',
      'dtn://worksphere/cloud',
      payload,
      1200 // 1.2s lifetime
    );

    autoProtocol.storeBundle(bundles[0]);
    expect(autoProtocol.getStoredBundleCount()).toBe(1);

    // Advance 600ms (still alive)
    jest.advanceTimersByTime(600);
    expect(autoProtocol.getStoredBundleCount()).toBe(1);

    // Advance another 800ms (total 1400ms > 1200ms lifetime)
    jest.advanceTimersByTime(800);

    // Interval tick will have automatically cleaned it up
    expect(autoProtocol.getStoredBundleCount()).toBe(0);
    autoProtocol.stopSweepInterval();
  });

  it('purges expired bundles in BLEMeshRouter queue', () => {
    const router = new BLEMeshRouter();
    const payload = new TextEncoder().encode('Router queue message');

    router.enqueueMessage(
      'dtn://worksphere/user-charlie',
      'dtn://worksphere/venue-456',
      payload,
      BundlePriority.NORMAL,
      2000 // 2s lifetime
    );

    expect(router.getQueueLength()).toBe(1);

    // Advance past expiration
    jest.advanceTimersByTime(2500);

    expect(router.getQueueLength()).toBe(0);
    expect(router.getQueue().length).toBe(0);
  });
});
