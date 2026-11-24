import { describe, it, expect, beforeEach } from 'vitest';
import {
  NFCDeskCheckinController,
  DeskState,
} from '../../core/iot/NFCDeskCheckinController';
import type { NFCTapPayload } from '../../core/iot/NFCDeskCheckinController';

describe('NFCDeskCheckinController - ISO 14443 NFC & Smart Presence State Machine', () => {
  let controller: NFCDeskCheckinController;
  const deskKey = 'secret-desk-key-9988';
  const deskId = 'desk-alpha-101';

  beforeEach(() => {
    controller = new NFCDeskCheckinController({
      maxClockSkewMs: 30000,
      defaultGracePeriodMs: 600000, // 10 minutes
      nonceCacheTtlMs: 60000,
    });
    controller.registerDesk(deskId, deskKey, 600000);
  });

  function createValidPayload(
    userId: string = 'user-alice',
    dId: string = deskId,
    tagUid: string = '04A1B2C3D4E5F6',
    timestamp: number = Date.now(),
    nonce: string = Math.random().toString(36).substring(2)
  ): NFCTapPayload {
    const signature = controller.computeTapSignature(deskKey, tagUid, userId, dId, timestamp, nonce);
    return {
      tagUid,
      userId,
      deskId: dId,
      timestamp,
      nonce,
      signature,
    };
  }

  describe('Registration & Tap Validation', () => {
    it('successfully checks in with valid cryptographic signature and fresh timestamp', () => {
      let eventFired = false;
      controller.onDeskCheckin = (d, u) => {
        if (d === deskId && u === 'user-alice') eventFired = true;
      };

      const payload = createValidPayload('user-alice');
      const res = controller.checkIn(payload, payload.timestamp);

      expect(res.success).toBe(true);
      expect(res.state).toBe(DeskState.OCCUPIED);
      expect(eventFired).toBe(true);

      const status = controller.getDeskStatus(deskId);
      expect(status?.activeUserId).toBe('user-alice');
      expect(status?.state).toBe(DeskState.OCCUPIED);
    });

    it('rejects tap with forged signature', () => {
      const payload = createValidPayload('user-alice');
      payload.signature = 'bad-signature-hex';

      const res = controller.checkIn(payload, payload.timestamp);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid cryptographic NFC signature');
    });

    it('rejects replay attack with duplicate nonce', () => {
      const payload = createValidPayload('user-alice');
      const res1 = controller.checkIn(payload, payload.timestamp);
      expect(res1.success).toBe(true);

      // Re-use identical nonce
      const res2 = controller.checkIn(payload, payload.timestamp + 500);
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('Replay attack detected');
    });

    it('rejects tap if timestamp drift exceeds maxClockSkewMs', () => {
      const pastTime = Date.now() - 45000; // 45 seconds old (limit is 30s)
      const payload = createValidPayload('user-alice', deskId, '04A1B2C3D4E5F6', pastTime);

      const res = controller.checkIn(payload, Date.now());
      expect(res.success).toBe(false);
      expect(res.error).toContain('exceeds max clock skew');
    });
  });

  describe('Check-Out & Session Tracking', () => {
    it('checks out successfully and records session duration', () => {
      let checkedOutDuration = 0;
      controller.onDeskCheckout = (d, u, dur) => {
        checkedOutDuration = dur;
      };

      const t0 = 1000000;
      const checkInPayload = createValidPayload('user-alice', deskId, '04A1B2C3D4E5F6', t0, 'nonce-in');
      controller.checkIn(checkInPayload, t0);

      const t1 = t0 + 7200000; // 2 hours later
      const checkOutPayload = createValidPayload('user-alice', deskId, '04A1B2C3D4E5F6', t1, 'nonce-out');
      const res = controller.checkOut(checkOutPayload, t1);

      expect(res.success).toBe(true);
      expect(res.state).toBe(DeskState.AVAILABLE);
      expect(res.sessionDurationMs).toBe(7200000);
      expect(checkedOutDuration).toBe(7200000);
      expect(controller.getDeskStatus(deskId)?.state).toBe(DeskState.AVAILABLE);
    });

    it('rejects checkout attempt by non-occupant', () => {
      const t0 = 1000000;
      controller.checkIn(createValidPayload('user-alice', deskId, '04A1B2C3D4E5F6', t0, 'n1'), t0);

      const wrongUserPayload = createValidPayload('user-bob', deskId, '04A1B2C3D4E5F6', t0 + 1000, 'n2');
      const res = controller.checkOut(wrongUserPayload, t0 + 1000);

      expect(res.success).toBe(false);
      expect(res.error).toContain('Only the active checked-in user can check out');
    });
  });

  describe('Presence & Automated Grace Period Release', () => {
    it('transitions to TEMPORARILY_AWAY when sensor reports vacant, and restores on return', () => {
      const t0 = 1000000;
      controller.checkIn(createValidPayload('user-alice', deskId, '04A1B2C3D4E5F6', t0, 'n1'), t0);

      // Sensor detects user stepped away
      const stateAway = controller.reportPresence(deskId, false, t0 + 5000);
      expect(stateAway).toBe(DeskState.TEMPORARILY_AWAY);

      // Sensor detects user returned
      const stateReturn = controller.reportPresence(deskId, true, t0 + 15000);
      expect(stateReturn).toBe(DeskState.OCCUPIED);
    });

    it('auto-releases desk if user remains away beyond grace period', () => {
      let releasedDeskId = '';
      controller.onDeskAutoReleased = (d) => {
        releasedDeskId = d;
      };

      const t0 = 1000000;
      controller.checkIn(createValidPayload('user-alice', deskId, '04A1B2C3D4E5F6', t0, 'n1'), t0);
      controller.reportPresence(deskId, false, t0 + 5000); // Away at 1005000

      // Grace period is 600000ms (10 mins) -> Expiry at 1605000
      // Check at 5 mins (should not expire)
      const nonExpired = controller.checkExpiredDesks(t0 + 300000);
      expect(nonExpired).toHaveLength(0);
      expect(controller.getDeskStatus(deskId)?.state).toBe(DeskState.TEMPORARILY_AWAY);

      // Check at 11 mins (exceeds grace period)
      const expired = controller.checkExpiredDesks(t0 + 5000 + 600001);
      expect(expired).toContain(deskId);
      expect(releasedDeskId).toBe(deskId);
      expect(controller.getDeskStatus(deskId)?.state).toBe(DeskState.AVAILABLE);
    });
  });

  describe('onTapRejected callback', () => {
    it('fires for an invalid signature as well as onUnauthorizedTap', () => {
      const rejected: string[] = [];
      let unauthorized = 0;
      controller.onTapRejected = (_d, reason) => rejected.push(reason);
      controller.onUnauthorizedTap = () => {
        unauthorized++;
      };

      const payload = createValidPayload('user-alice');
      const res = controller.checkIn({ ...payload, signature: 'deadbeef' }, payload.timestamp);

      expect(res.success).toBe(false);
      expect(rejected).toHaveLength(1);
      expect(unauthorized).toBe(1);
    });

    it('fires when the desk is occupied by another user', () => {
      const rejected: string[] = [];
      const first = createValidPayload('user-alice');
      controller.checkIn(first, first.timestamp);

      controller.onTapRejected = (_d, reason) => rejected.push(reason);
      const second = createValidPayload('user-bob');
      const res = controller.checkIn(second, second.timestamp);

      expect(res.success).toBe(false);
      expect(rejected).toEqual(['Desk is already occupied by user user-alice']);
    });

    it('does not fire on a successful check-in', () => {
      let fired = false;
      controller.onTapRejected = () => {
        fired = true;
      };
      const payload = createValidPayload('user-alice');
      expect(controller.checkIn(payload, payload.timestamp).success).toBe(true);
      expect(fired).toBe(false);
    });
  });
});
