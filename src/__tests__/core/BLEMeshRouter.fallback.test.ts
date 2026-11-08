import { BLEMeshRouter } from '@/core/network/BLEMeshRouter';
import { BundlePriority } from '@/core/network/DTNBundleProtocol';

describe('BLEMeshRouter unreachable destination fallback & route eviction (#5734)', () => {
  let router: BLEMeshRouter;

  beforeEach(() => {
    jest.useFakeTimers();
    router = new BLEMeshRouter();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes active route upon enqueuing message', () => {
    const payload = new Uint8Array([1, 2, 3]);
    router.enqueueMessage(
      'dtn://worksphere/user-alice',
      'dtn://worksphere/user-bob',
      payload
    );

    const route = router.getRoute('dtn://worksphere/user-bob');
    expect(route).toBeDefined();
    expect(route?.status).toBe('active');
    expect(route?.failureCount).toBe(0);
    expect(route?.nextRetryTimestamp).toBe(0);
  });

  it('implements exponential backoff on delivery failure', () => {
    const dest = 'dtn://worksphere/unreachable-peer';
    router.setRoute(dest, 'active');

    const now = Date.now();

    // 1st failure: 1000ms * 2^0 = 1000ms backoff
    const fail1 = router.recordDeliveryFailure(dest, 'bundle-1');
    expect(fail1.retriesExhausted).toBe(false);
    expect(fail1.routeEvicted).toBe(false);

    let route = router.getRoute(dest);
    expect(route?.status).toBe('dormant');
    expect(route?.failureCount).toBe(1);
    expect(route?.nextRetryTimestamp).toBe(now + 1000);

    // 2nd failure: 1000ms * 2^1 = 2000ms backoff
    const fail2 = router.recordDeliveryFailure(dest, 'bundle-1');
    expect(fail2.retriesExhausted).toBe(false);
    expect(fail2.routeEvicted).toBe(false);

    route = router.getRoute(dest);
    expect(route?.status).toBe('dormant');
    expect(route?.failureCount).toBe(2);
    expect(route?.nextRetryTimestamp).toBe(now + 2000);
  });

  it('evicts stale route after 3 failed delivery attempts (#5734)', () => {
    const dest = 'dtn://worksphere/dropped-peer';
    router.setRoute(dest, 'active');

    router.recordDeliveryFailure(dest, 'bundle-2');
    router.recordDeliveryFailure(dest, 'bundle-2');

    // 3rd failure: reaches MAX_RETRY_LIMIT (3)
    const fail3 = router.recordDeliveryFailure(dest, 'bundle-2');
    expect(fail3.retriesExhausted).toBe(true);
    expect(fail3.routeEvicted).toBe(true);

    // Route should be evicted from routing table
    expect(router.getRoute(dest)).toBeUndefined();
  });

  it('purges bundle from queue once max retries are exhausted', () => {
    const payload = new Uint8Array([4, 5, 6]);
    const dest = 'dtn://worksphere/vanished-node';
    router.enqueueMessage(
      'dtn://worksphere/user-alice',
      dest,
      payload,
      BundlePriority.NORMAL,
      60000
    );

    expect(router.getQueueLength()).toBe(1);

    const bundle = router.getQueue()[0];
    const bundleId = `${bundle.header.source}:${bundle.header.sequenceNumber}:${bundle.header.creationTimestamp}:${bundle.header.fragmentOffset}`;

    // Fail delivery 3 times
    router.recordDeliveryFailure(dest, bundleId);
    router.recordDeliveryFailure(dest, bundleId);
    router.recordDeliveryFailure(dest, bundleId);

    // Queue purge removes exhausted bundle
    const expired = router.purgeExpiredQueue();
    expect(expired.length).toBe(1);
    expect(router.getQueueLength()).toBe(0);
  });

  it('re-activates route and resets failure counter upon successful delivery', () => {
    const dest = 'dtn://worksphere/recovered-peer';
    router.setRoute(dest, 'active');

    router.recordDeliveryFailure(dest, 'bundle-3');
    expect(router.getRoute(dest)?.failureCount).toBe(1);
    expect(router.getRoute(dest)?.status).toBe('dormant');

    // Success recovery
    router.recordDeliverySuccess(dest, 'bundle-3');
    const route = router.getRoute(dest);
    expect(route?.status).toBe('active');
    expect(route?.failureCount).toBe(0);
    expect(route?.nextRetryTimestamp).toBe(0);
  });
});
