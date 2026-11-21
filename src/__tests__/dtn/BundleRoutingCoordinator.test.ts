import {
  BundleRoutingCoordinator,
  Bundle,
  ContactWindow,
  CustodySignal,
} from '../../core/dtn/BundleRoutingCoordinator';

describe('BundleRoutingCoordinator', () => {
  let coordinator: BundleRoutingCoordinator;
  const localNode = 'dtn://node-gateway-1';
  const secretKey = 'test-dtn-key';

  beforeEach(() => {
    coordinator = new BundleRoutingCoordinator(localNode, 1024 * 100, secretKey); // 100 KB limit
  });

  describe('Bundle Creation & Cryptographic Integrity', () => {
    it('creates a bundle with valid SHA-256 digest and custody initialization', () => {
      const payload = { task: 'sync-inventory', timestamp: 123456 };
      const bundle = coordinator.createBundle('dtn://node-remote-sink', payload, {
        priority: 'EXPEDITED',
        custodyRequested: true,
      });

      expect(bundle.header.source).toBe(localNode);
      expect(bundle.header.destination).toBe('dtn://node-remote-sink');
      expect(bundle.header.priority).toBe('EXPEDITED');
      expect(bundle.header.custodyTransferRequested).toBe(true);
      expect(bundle.custodyChain).toContain(localNode);

      const expectedDigest = coordinator.computeDigest(JSON.stringify(payload));
      expect(bundle.payloadDigest).toBe(expectedDigest);

      const custody = coordinator.getCustodyRecord(bundle.header.bundleId);
      expect(custody?.state).toBe('HELD');
    });

    it('rejects bundles with corrupted or tampered payloads', () => {
      const bundle = coordinator.createBundle('dtn://node-dest', 'original payload');
      const tampered: Bundle = {
        ...bundle,
        payload: 'tampered payload without updating digest',
      };

      const result = coordinator.receiveBundle(tampered);
      expect(result.accepted).toBe(false);
      expect(result.signal.reasonCode).toBe('CORRUPTED');
      expect(result.signal.accepted).toBe(false);
    });

    it('rejects expired bundles', () => {
      const bundle = coordinator.createBundle('dtn://node-dest', 'hello', {
        lifetimeMs: 1000,
      });
      const futureTime = bundle.header.creationTimestamp + 5000;

      const result = coordinator.receiveBundle(bundle, futureTime);
      expect(result.accepted).toBe(false);
      expect(result.signal.reasonCode).toBe('EXPIRED');
    });
  });

  describe('Contact Window Scheduling & Opportunistic Forwarding', () => {
    it('defers forwarding when no active contact windows exist', () => {
      coordinator.createBundle('dtn://node-dest', 'data-payload');
      const now = Date.now();
      const dispatch = coordinator.forwardBundles(now);

      expect(dispatch.dispatched.length).toBe(0);
      expect(dispatch.deferred.length).toBe(1);
    });

    it('dispatches bundles opportunistically during active contact window', () => {
      const now = Date.now();
      const contact: ContactWindow = {
        contactId: 'contact-orbit-1',
        peer: 'dtn://relay-sat-1',
        startTime: now - 1000,
        endTime: now + 60000,
        throughputBps: 50000,
        isActive: true,
      };
      coordinator.addContact(contact);

      const b1 = coordinator.createBundle('dtn://relay-sat-1', 'direct message');
      const dispatch = coordinator.forwardBundles(now);

      expect(dispatch.dispatched.length).toBe(1);
      expect(dispatch.dispatched[0].bundleId).toBe(b1.header.bundleId);
      expect(dispatch.dispatched[0].peer).toBe('dtn://relay-sat-1');
    });

    it('respects priority ordering (EXPEDITED before NORMAL before BULK)', () => {
      const now = Date.now();
      const contact: ContactWindow = {
        contactId: 'contact-link-1',
        peer: 'dtn://relay-station',
        startTime: now - 5000,
        endTime: now + 5000,
        throughputBps: 10000,
        isActive: true,
      };
      coordinator.addContact(contact);

      const bBulk = coordinator.createBundle('dtn://dest', 'bulk telemetry', { priority: 'BULK' });
      const bExpedited = coordinator.createBundle('dtn://dest', 'emergency shutdown', { priority: 'EXPEDITED' });
      const bNormal = coordinator.createBundle('dtn://dest', 'status update', { priority: 'NORMAL' });

      const dispatch = coordinator.forwardBundles(now);
      const dispatchedIds = dispatch.dispatched.map((d) => d.bundleId);

      expect(dispatchedIds[0]).toBe(bExpedited.header.bundleId);
      expect(dispatchedIds[1]).toBe(bNormal.header.bundleId);
      expect(dispatchedIds[2]).toBe(bBulk.header.bundleId);
    });
  });

  describe('Fragmentation and Reassembly', () => {
    it('fragments payload when exceeding chunk size limit', () => {
      const longPayload = 'A'.repeat(500);
      const bundle = coordinator.createBundle('dtn://far-node', longPayload);

      const fragments = coordinator.fragmentBundle(bundle, 120);
      expect(fragments.length).toBe(5); // 500 / 120 = 4 full chunks (480) + 1 partial chunk (20)
      expect(fragments[0].header.isFragment).toBe(true);
      expect(fragments[0].header.fragmentOffset).toBe(0);
      expect(fragments[0].header.totalPayloadLength).toBe(500);
      expect(fragments[4].header.fragmentOffset).toBe(480);
      expect(fragments[4].payload.length).toBe(20);
    });

    it('reassembles fragments upon receiving all parts', () => {
      const longPayload = 'WorkSphere-Delay-Tolerant-Networking-Payload-Reassembly-Test';
      const bundle = coordinator.createBundle('dtn://far-node', longPayload);
      const fragments = coordinator.fragmentBundle(bundle, 15);

      const receiver = new BundleRoutingCoordinator('dtn://receiver-node', 1024 * 100, secretKey);

      // Deliver fragments out of order
      receiver.receiveBundle(fragments[1]);
      receiver.receiveBundle(fragments[3]);
      receiver.receiveBundle(fragments[0]);
      receiver.receiveBundle(fragments[2]);

      // If more fragments exist, receive them all
      for (let i = 4; i < fragments.length; i++) {
        receiver.receiveBundle(fragments[i]);
      }

      // Check reassembled bundle
      const stored = receiver.getStoredBundles();
      expect(stored.length).toBe(1);
      expect(stored[0].payload).toBe(longPayload);
      expect(stored[0].header.isFragment).toBeFalsy();
    });
  });

  describe('Custody Transfer Protocol (RFC 5050)', () => {
    it('releases local custody when valid downstream custody acceptance signal is received', () => {
      const bundle = coordinator.createBundle('dtn://sink', 'custody payload', { custodyRequested: true });
      const bundleId = bundle.header.bundleId;

      const recordBefore = coordinator.getCustodyRecord(bundleId);
      expect(recordBefore?.state).toBe('HELD');

      // Generate valid signed CustodySignal from downstream peer
      const now = Date.now();
      const downstreamPeer = 'dtn://next-hop-custodian';
      const sigPayload = `${bundleId}:${downstreamPeer}:true:SUCCESS:${now}`;
      const signature = coordinator.computeHmac(sigPayload);

      const signal: CustodySignal = {
        bundleId,
        custodian: downstreamPeer,
        accepted: true,
        reasonCode: 'SUCCESS',
        timestamp: now,
        signature,
      };

      const handled = coordinator.handleCustodySignal(signal);
      expect(handled).toBe(true);

      const recordAfter = coordinator.getCustodyRecord(bundleId);
      expect(recordAfter?.state).toBe('RELEASED');
      expect(recordAfter?.custodian).toBe(downstreamPeer);
      expect(coordinator.getBundle(bundleId)).toBeUndefined(); // Storage freed
    });

    it('rejects tampered custody signal signatures', () => {
      const bundle = coordinator.createBundle('dtn://sink', 'data');
      const signal: CustodySignal = {
        bundleId: bundle.header.bundleId,
        custodian: 'dtn://forged-node',
        accepted: true,
        reasonCode: 'SUCCESS',
        timestamp: Date.now(),
        signature: 'invalid-signature-hash',
      };

      const handled = coordinator.handleCustodySignal(signal);
      expect(handled).toBe(false);
      expect(coordinator.getCustodyRecord(bundle.header.bundleId)?.state).toBe('HELD');
    });
  });

  describe('Storage Management & Expiration Pruning', () => {
    it('prunes expired bundles from store', () => {
      const now = Date.now();
      const b1 = coordinator.createBundle('dtn://node', 'msg1', { lifetimeMs: 1000 });
      const b2 = coordinator.createBundle('dtn://node', 'msg2', { lifetimeMs: 100000 });

      const pruned = coordinator.pruneExpiredBundles(now + 5000);
      expect(pruned).toContain(b1.header.bundleId);
      expect(pruned).not.toContain(b2.header.bundleId);
      expect(coordinator.getBundle(b1.header.bundleId)).toBeUndefined();
      expect(coordinator.getBundle(b2.header.bundleId)).toBeDefined();
    });

    it('calculates storage usage metrics accurately', () => {
      coordinator.createBundle('dtn://node', 'small');
      const usage = coordinator.getStorageUsage();
      expect(usage.count).toBe(1);
      expect(usage.usedBytes).toBeGreaterThan(0);
      expect(usage.percentage).toBeLessThan(100);
    });
  });
});
