import { SeatHoldLifecycleManager } from '../seatHoldLifecycle';

describe('SeatHoldLifecycleManager (#9324)', () => {
  it('expires HELD seats on sweep while leaving CONFIRMED bookings untouched', () => {
    const mgr = new SeatHoldLifecycleManager();

    const heldSeat = mgr.createHold('desk-1', 'user-a', 5_000, 10_000);
    const confirmedSeat = mgr.createHold('desk-2', 'user-b', 5_000, 10_000);

    expect(heldSeat.ok).toBe(true);
    expect(confirmedSeat.ok).toBe(true);

    const confirmRes = mgr.confirmHold(
      'desk-2',
      confirmedSeat.record!.holdToken,
      'bk-900',
      12_000
    );
    expect(confirmRes.ok).toBe(true);

    const swept = mgr.sweepExpiredHolds(16_000);
    expect(swept).toHaveLength(1);
    expect(swept[0].seatId).toBe('desk-1');
    expect(swept[0].status).toBe('EXPIRED');
    expect(mgr.getHold('desk-2')?.status).toBe('CONFIRMED');

    const nextHold = mgr.createHold('desk-1', 'user-c', 5_000, 16_500);
    expect(nextHold.ok).toBe(true);
    expect(nextHold.record?.userId).toBe('user-c');
  });

  it('rejects mismatched or expired tokens on confirm/release and handles idempotent release', () => {
    const mgr = new SeatHoldLifecycleManager();
    const created = mgr.createHold('desk-9', 'user-x', 5_000, 1_000);
    const token = created.record!.holdToken;

    const wrongTokenConfirm = mgr.confirmHold('desk-9', 'wrong_token', 'bk-1', 2_000);
    expect(wrongTokenConfirm.ok).toBe(false);
    expect(wrongTokenConfirm.code).toBe('INVALID_TOKEN');

    const firstRelease = mgr.releaseHold('desk-9', token, 2_500);
    expect(firstRelease.ok).toBe(true);
    expect(firstRelease.code).toBe('OK');

    const secondRelease = mgr.releaseHold('desk-9', token, 3_000);
    expect(secondRelease.ok).toBe(true);
    expect(secondRelease.code).toBe('ALREADY_RELEASED');

    const lateConfirm = mgr.confirmHold('desk-9', token, 'bk-2', 3_100);
    expect(lateConfirm.ok).toBe(false);
    expect(lateConfirm.code).toBe('INVALID_STATE');
  });
});