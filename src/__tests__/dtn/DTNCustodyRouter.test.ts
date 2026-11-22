import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DTNCustodyRouter,
  CustodyReasonCode,
} from '../../core/dtn/DTNCustodyRouter';
import type { CustodySignal } from '../../core/dtn/DTNCustodyRouter';

describe('DTNCustodyRouter - Delay-Tolerant Networking Custody Transfer Protocol', () => {
  let router: DTNCustodyRouter;

  beforeEach(() => {
    vi.useFakeTimers();
    router = new DTNCustodyRouter({
      localNodeId: 'node-alpha-101',
      maxStorageBytes: 10 * 1024 * 1024, // 10MB
      maxBundles: 100,
      defaultRtoMs: 2000,
      backoffMultiplier: 2,
      maxRetransmits: 3,
    });
  });

  afterEach(() => {
    router.destroy();
    vi.useRealTimers();
  });

  describe('Admission Control & Buffer Quota', () => {
    it('admitBundle admits valid bundle and takes local custody', () => {
      const res = router.admitBundle({
        bundleId: 'bundle-001',
        sourceEndpoint: 'node-alpha-101',
        destinationEndpoint: 'node-gamma-303',
        payloadSizeBytes: 1024,
        payload: { message: 'interplanetary telemetry' },
        lifetimeTTLMs: 60000,
        custodyRequested: true,
      });

      expect(res.admitted).toBe(true);
      expect(res.signal).toBeDefined();
      expect(res.signal?.isAccepted).toBe(true);
      expect(res.signal?.reasonCode).toBe(CustodyReasonCode.SUCCESS);

      const record = router.getBundleRecord('bundle-001');
      expect(record?.custodyState).toBe('HELD_LOCALLY');
      expect(record?.currentCustodian).toBe('node-alpha-101');

      const stats = router.getStats();
      expect(stats.activeCustodyCount).toBe(1);
      expect(stats.currentStorageBytes).toBe(1024);
    });

    it('rejects admission if payload exceeds storage capacity', () => {
      const smallRouter = new DTNCustodyRouter({
        localNodeId: 'node-tiny',
        maxStorageBytes: 500,
      });

      const res = smallRouter.admitBundle({
        bundleId: 'bundle-heavy',
        sourceEndpoint: 'src',
        destinationEndpoint: 'dst',
        payloadSizeBytes: 1000,
        payload: 'huge data',
        lifetimeTTLMs: 60000,
        custodyRequested: true,
      });

      expect(res.admitted).toBe(false);
      expect(res.signal?.isAccepted).toBe(false);
      expect(res.signal?.reasonCode).toBe(CustodyReasonCode.DEPLETED_STORAGE);
      smallRouter.destroy();
    });

    it('rejects bundle if lifetime TTL already expired', () => {
      const res = router.admitBundle({
        bundleId: 'bundle-old',
        sourceEndpoint: 'src',
        destinationEndpoint: 'dst',
        payloadSizeBytes: 100,
        payload: 'old',
        lifetimeTTLMs: 1000,
        creationTimestamp: Date.now() - 5000,
        custodyRequested: true,
      });

      expect(res.admitted).toBe(false);
      expect(res.reason).toContain('expired');
    });
  });

  describe('Custody Forwarding & Timer Management', () => {
    beforeEach(() => {
      router.admitBundle({
        bundleId: 'bundle-fwd-01',
        sourceEndpoint: 'node-alpha-101',
        destinationEndpoint: 'node-gamma-303',
        payloadSizeBytes: 2048,
        payload: { log: 'mesh packet' },
        lifetimeTTLMs: 120000,
        custodyRequested: true,
      });
    });

    it('forwardBundleWithCustody arms CTT timer and updates state to FORWARDED_PENDING_ACK', () => {
      const res = router.forwardBundleWithCustody('bundle-fwd-01', 'node-beta-202');
      expect(res.forwarded).toBe(true);
      expect(res.rtoMs).toBe(2000);

      const record = router.getBundleRecord('bundle-fwd-01');
      expect(record?.custodyState).toBe('FORWARDED_PENDING_ACK');
      expect(record?.forwardedToCustodian).toBe('node-beta-202');
    });

    it('retransmits with exponential backoff on CTT expiration', () => {
      router.forwardBundleWithCustody('bundle-fwd-01', 'node-beta-202');

      // First timeout at 2000ms
      vi.advanceTimersByTime(2000);
      let record = router.getBundleRecord('bundle-fwd-01');
      expect(record?.retransmitAttempts).toBe(1);
      expect(record?.rtoMs).toBe(4000);

      // Second timeout at 4000ms
      vi.advanceTimersByTime(4000);
      record = router.getBundleRecord('bundle-fwd-01');
      expect(record?.retransmitAttempts).toBe(2);
      expect(record?.rtoMs).toBe(8000);

      // Third timeout at 8000ms
      vi.advanceTimersByTime(8000);
      record = router.getBundleRecord('bundle-fwd-01');
      expect(record?.retransmitAttempts).toBe(3);
      expect(record?.rtoMs).toBe(16000);

      // Fourth timeout exceeds maxRetransmits (3)
      vi.advanceTimersByTime(16000);
      record = router.getBundleRecord('bundle-fwd-01');
      expect(record?.custodyState).toBe('EXPIRED');
    });
  });

  describe('Custody Signal Acknowledgment & Transfer', () => {
    it('releases local custody and frees buffer memory upon receiving positive ACK', () => {
      let releasedNotified = false;
      router.onCustodyReleased = (bId) => {
        if (bId === 'bundle-ack-01') releasedNotified = true;
      };

      router.admitBundle({
        bundleId: 'bundle-ack-01',
        sourceEndpoint: 'node-alpha-101',
        destinationEndpoint: 'node-gamma-303',
        payloadSizeBytes: 4096,
        payload: 'vital bundle',
        lifetimeTTLMs: 60000,
        custodyRequested: true,
      });

      expect(router.getStats().currentStorageBytes).toBe(4096);

      router.forwardBundleWithCustody('bundle-ack-01', 'node-beta-202');

      const validToken = router.computeAcknowledgmentToken('bundle-ack-01', 'node-beta-202');
      const ackSignal: CustodySignal = {
        signalId: 'sig-001',
        bundleId: 'bundle-ack-01',
        isAccepted: true,
        reasonCode: CustodyReasonCode.SUCCESS,
        custodianEndpoint: 'node-beta-202',
        signalTimestamp: Date.now(),
        acknowledgmentToken: validToken,
      };

      const processRes = router.processCustodySignal(ackSignal);
      expect(processRes.success).toBe(true);
      expect(processRes.newState).toBe('CUSTODY_RELEASED');
      expect(releasedNotified).toBe(true);

      // Local storage must now be freed
      expect(router.getStats().currentStorageBytes).toBe(0);
      expect(router.getStats().releasedCount).toBe(1);
    });

    it('rejects custody signal with forged/tampered acknowledgment token', () => {
      router.admitBundle({
        bundleId: 'bundle-forged',
        sourceEndpoint: 'src',
        destinationEndpoint: 'dst',
        payloadSizeBytes: 512,
        payload: 'data',
        lifetimeTTLMs: 60000,
        custodyRequested: true,
      });

      router.forwardBundleWithCustody('bundle-forged', 'node-beta-202');

      const forgedSignal: CustodySignal = {
        signalId: 'sig-forged',
        bundleId: 'bundle-forged',
        isAccepted: true,
        reasonCode: CustodyReasonCode.SUCCESS,
        custodianEndpoint: 'node-beta-202',
        signalTimestamp: Date.now(),
        acknowledgmentToken: 'tampered-token-1234',
      };

      const res = router.processCustodySignal(forgedSignal);
      expect(res.success).toBe(false);
      expect(res.reason).toContain('Invalid custody acknowledgment token');
      expect(router.getBundleRecord('bundle-forged')?.custodyState).toBe('FORWARDED_PENDING_ACK');
    });

    it('handles negative custody refusal NACK signal', () => {
      let refusalCalled = false;
      router.onCustodyRefused = (bId) => {
        if (bId === 'bundle-refuse') refusalCalled = true;
      };

      router.admitBundle({
        bundleId: 'bundle-refuse',
        sourceEndpoint: 'src',
        destinationEndpoint: 'dst',
        payloadSizeBytes: 512,
        payload: 'data',
        lifetimeTTLMs: 60000,
        custodyRequested: true,
      });

      router.forwardBundleWithCustody('bundle-refuse', 'node-beta-202');

      const token = router.computeAcknowledgmentToken('bundle-refuse', 'node-beta-202');
      const nackSignal: CustodySignal = {
        signalId: 'sig-nack',
        bundleId: 'bundle-refuse',
        isAccepted: false,
        reasonCode: CustodyReasonCode.DEPLETED_STORAGE,
        custodianEndpoint: 'node-beta-202',
        signalTimestamp: Date.now(),
        acknowledgmentToken: token,
      };

      const res = router.processCustodySignal(nackSignal);
      expect(res.success).toBe(true);
      expect(res.newState).toBe('CUSTODY_REFUSED');
      expect(refusalCalled).toBe(true);
    });
  });

  describe('Cleanup & Eviction', () => {
    it('cleanupExpiredBundles clears expired records and reclaims memory', () => {
      const now = 1000000;
      router.admitBundle({
        bundleId: 'b-expiring',
        sourceEndpoint: 'src',
        destinationEndpoint: 'dst',
        payloadSizeBytes: 1000,
        payload: 'data',
        lifetimeTTLMs: 10000,
        creationTimestamp: now - 15000,
        custodyRequested: false,
      });

      const purged = router.cleanupExpiredBundles(now);
      expect(purged).toBe(1);
      expect(router.getBundleRecord('b-expiring')).toBeUndefined();
    });
  });
});
