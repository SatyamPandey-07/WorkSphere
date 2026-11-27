import { createHmac } from 'crypto';
import {
  DeskState,
  NFC_PAYLOAD_VERSION,
  NFCDeskCheckinController,
  type NFCTapPayload,
  type TapOperation,
} from '@/core/iot/NFCDeskCheckinController';

describe('NFCDeskCheckinController cryptographic verification & durable state (#10694)', () => {
  const deskId = 'desk-sec-1';
  const deskKey = 'super-secret-hmac-key-256';
  const tagUid = '04A1B2C3D4E5F6';
  let controller: NFCDeskCheckinController;

  beforeEach(() => {
    controller = new NFCDeskCheckinController();
    controller.registerDesk(deskId, deskKey);
  });

  function signTap(
    userId: string,
    operation: TapOperation,
    timestamp: number,
    nonce: string,
    key: string = deskKey,
  ): NFCTapPayload {
    const signature = controller.computeTapSignature(
      key,
      tagUid,
      userId,
      deskId,
      operation,
      timestamp,
      nonce,
    );
    return {
      tagUid,
      userId,
      deskId,
      operation,
      timestamp,
      nonce,
      version: NFC_PAYLOAD_VERSION,
      signature,
    };
  }

  it('produces standard 64-char HMAC-SHA256 hex digest matching Node crypto', () => {
    const t0 = 1_700_000_000_000;
    const sig = controller.computeTapSignature(
      deskKey,
      tagUid,
      'user-1',
      deskId,
      'checkin',
      t0,
      'nonce-kat',
    );
    const expected = createHmac('sha256', deskKey)
      .update(`${NFC_PAYLOAD_VERSION}\n${tagUid}\nuser-1\n${deskId}\ncheckin\n${t0}\nnonce-kat`, 'utf8')
      .digest('hex');

    expect(sig).toHaveLength(64);
    expect(sig).toBe(expected);
  });

  it('rejects a correctly signed timestamp beyond the future clock-skew boundary', () => {
    const now = 1_700_000_000_000;
    const tap = signTap('user-1', 'checkin', now + 30_001, 'nonce-future-expired');

    const result = controller.checkIn(tap, now);

    expect(result).toEqual({
      success: false,
      state: DeskState.AVAILABLE,
      error: 'Timestamp drift 30001ms exceeds max clock skew of 30000ms',
    });
    expect(controller.getDeskStatus(deskId)?.state).toBe(DeskState.AVAILABLE);
  });

  it('accepts a timestamp exactly at the inclusive future clock-skew boundary', () => {
    const now = 1_700_000_000_000;
    const tap = signTap('user-1', 'checkin', now + 30_000, 'nonce-future-boundary');

    const result = controller.checkIn(tap, now);

    expect(result.success).toBe(true);
    expect(result.state).toBe(DeskState.OCCUPIED);
  });

  it('accepts a correctly signed timestamp within the future-skew window', () => {
    const now = 1_700_000_000_000;
    const tap = signTap('user-1', 'checkin', now + 15_000, 'nonce-future-valid');

    expect(controller.checkIn(tap, now).success).toBe(true);
  });

  it('continues rejecting timestamps beyond the past-expiry boundary', () => {
    const now = 1_700_000_000_000;
    const tap = signTap('user-1', 'checkin', now - 30_001, 'nonce-past-expired');

    const result = controller.checkIn(tap, now);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Timestamp drift 30001ms exceeds max clock skew of 30000ms',
    );
    expect(controller.getDeskStatus(deskId)?.state).toBe(DeskState.AVAILABLE);
  });

  it('does not consume nonce or mutate desk state when signature is invalid', () => {
    const t0 = 1_700_000_000_000;
    const forged = signTap('user-1', 'checkin', t0, 'nonce-shared');
    forged.signature = '0'.repeat(64);

    const forgedRes = controller.checkIn(forged, t0);
    expect(forgedRes.success).toBe(false);
    expect(controller.getDeskStatus(deskId)?.state).toBe(DeskState.AVAILABLE);

    // Same nonce must still succeed once presented with a valid HMAC signature.
    const valid = signTap('user-1', 'checkin', t0, 'nonce-shared');
    const validRes = controller.checkIn(valid, t0);
    expect(validRes.success).toBe(true);
    expect(validRes.state).toBe(DeskState.OCCUPIED);
  });

  it('rejects tampered fields, unknown protocol version, and cross-operation replay', () => {
    const t0 = 1_700_000_000_000;
    const checkinTap = signTap('user-1', 'checkin', t0, 'nonce-op');

    // Cross-operation replay into checkOut must fail
    const crossOpRes = controller.checkOut(checkinTap, t0);
    expect(crossOpRes.success).toBe(false);

    // Unsupported version must fail
    const badVer = { ...checkinTap, version: '99' };
    expect(controller.checkIn(badVer, t0).success).toBe(false);

    // Tampered userId must fail HMAC verification
    const tampered = { ...checkinTap, userId: 'user-attacker' };
    expect(controller.checkIn(tampered, t0).success).toBe(false);
  });

  it('blocks revoked tags and rotated-out keys, and preserves replay/desk state across restarts', () => {
    const t0 = 1_700_000_000_000;
    const tap1 = signTap('user-1', 'checkin', t0, 'nonce-persist');
    expect(controller.checkIn(tap1, t0).success).toBe(true);

    // Simulate process restart via snapshot export/restore
    const snapshot = controller.exportState();
    const restarted = new NFCDeskCheckinController();
    restarted.restoreState(snapshot);

    expect(restarted.getDeskStatus(deskId)?.state).toBe(DeskState.OCCUPIED);

    // Replaying the same valid tap on the restarted instance must be rejected
    const replayRes = restarted.checkIn(tap1, t0 + 100);
    expect(replayRes.success).toBe(false);
    expect(replayRes.error).toMatch(/Replay/i);

    // Revoking tag blocks previously valid signatures
    restarted.revokeTag(tagUid);
    const tapOut = signTap('user-1', 'checkout', t0 + 500, 'nonce-revoked');
    const revokedRes = restarted.checkOut(tapOut, t0 + 500);
    expect(revokedRes.success).toBe(false);
    expect(revokedRes.error).toMatch(/revoked/i);

    // Re-enroll tag and rotate desk key
    restarted.enrollTag(tagUid);
    const newKey = 'rotated-desk-key-v2';
    expect(restarted.rotateDeskKey(deskId, newKey)).toBe(true);
    expect(restarted.checkOut(tapOut, t0 + 500).success).toBe(false);

    const rotatedTapOut = signTap('user-1', 'checkout', t0 + 600, 'nonce-rot', newKey);
    expect(restarted.checkOut(rotatedTapOut, t0 + 600).success).toBe(true);
  });
});
