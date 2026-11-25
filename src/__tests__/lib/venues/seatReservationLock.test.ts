import {
  SeatLockConflictError,
  SeatReservationLockManager,
} from '@/lib/venues/seatReservationLock';

describe('Seat Reservation Concurrency Lock & Lease Expiry Manager', () => {
  it('prevents conflicting holders while lease is active and returns retryAfterMs', () => {
    const manager = new SeatReservationLockManager({ defaultTtlMs: 60_000 });
    const t0 = 1_700_000_000_000;

    const first = manager.acquireOrRenew('desk-powai-04', 'nomad-a', {
      nowMs: t0,
    });
    expect(first.acquired).toBe(true);
    expect(first.renewed).toBe(false);
    expect(first.lease.fenceToken).toBe(1);

    try {
      manager.acquireOrRenew('desk-powai-04', 'nomad-b', {
        nowMs: t0 + 10_000,
      });
      fail('Expected SeatLockConflictError');
    } catch (err) {
      expect(err).toBeInstanceOf(SeatLockConflictError);
      const conflict = err as SeatLockConflictError;
      expect(conflict.currentHolderId).toBe('nomad-a');
      expect(conflict.retryAfterMs).toBe(50_000);
      expect(conflict.toPayload().code).toBe('SEAT_LOCK_CONFLICT');
    }
  });

  it('supports idempotent holder renewal and treats nowMs >= expiresAtMs as expired', () => {
    const manager = new SeatReservationLockManager({ defaultTtlMs: 30_000 });
    const t0 = 1_700_000_000_000;

    const initial = manager.acquireOrRenew('pod-bandra-01', 'nomad-a', {
      nowMs: t0,
    });
    const renewed = manager.acquireOrRenew('pod-bandra-01', 'nomad-a', {
      nowMs: t0 + 15_000,
      ttlMs: 30_000,
    });

    expect(renewed.renewed).toBe(true);
    expect(renewed.lease.fenceToken).toBe(initial.lease.fenceToken);
    expect(renewed.lease.expiresAtMs).toBe(t0 + 45_000);

    const takeover = manager.acquireOrRenew('pod-bandra-01', 'nomad-b', {
      nowMs: t0 + 45_000,
    });
    expect(takeover.lease.holderId).toBe('nomad-b');
    expect(takeover.lease.fenceToken).toBe(initial.lease.fenceToken + 1);
  });

  it('blocks unauthorized release by non-holders and sweeps expired leases', () => {
    const manager = new SeatReservationLockManager({ defaultTtlMs: 20_000 });
    const t0 = 1_700_000_000_000;

    manager.acquireOrRenew('desk-andheri-09', 'nomad-owner', { nowMs: t0 });
    manager.acquireOrRenew('desk-andheri-10', 'nomad-other', { nowMs: t0 });

    expect(() =>
      manager.releaseLease('desk-andheri-09', 'nomad-intruder', t0 + 5_000)
    ).toThrow(SeatLockConflictError);

    expect(manager.releaseLease('desk-andheri-09', 'nomad-owner', t0 + 5_000)).toBe(
      true
    );

    const swept = manager.sweepExpired(t0 + 25_000);
    expect(swept).toBe(1);
    expect(manager.getActiveLease('desk-andheri-10', t0 + 25_000)).toBeNull();
  });
});
