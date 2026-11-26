/**
 * Smart Desk Presence & Cryptographic NFC Check-In Controller
 * Conforms to ISO/IEC 14443 Type A, NDEF verification, anti-replay guards,
 * and automated grace-period release state machines.
 *
 * Security model:
 * - Signatures are HMAC-SHA256 (Node.js `crypto` module), not FNV hashes.
 * - Canonical payload binds tagUid, userId, deskId, operation, timestamp,
 *   nonce, and protocol version so each field is unambiguously included.
 * - Nonce is consumed ONLY AFTER signature validation succeeds (verify-then-commit).
 * - MAC comparison uses `timingSafeEqual` to prevent timing side-channels.
 */
import { createHmac, timingSafeEqual } from 'crypto';

/** Wire protocol version embedded in every canonical payload. */
export const NFC_PAYLOAD_VERSION = '1';

export const DeskState = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  OCCUPIED: 'OCCUPIED',
  TEMPORARILY_AWAY: 'TEMPORARILY_AWAY',
  MAINTENANCE: 'MAINTENANCE',
} as const;

export type DeskState = (typeof DeskState)[keyof typeof DeskState];

/** NFC tap operations embedded in the canonical payload. */
export type TapOperation = 'checkin' | 'checkout';

export interface NFCTapPayload {
  tagUid: string; // ISO 14443A 7-byte UID hex
  userId: string;
  deskId: string;
  /** Unix epoch milliseconds supplied by the NFC tag firmware. */
  timestamp: number;
  nonce: string;
  /** Operation type included in canonical payload to prevent cross-operation replay. */
  operation: TapOperation;
  /** Optional protocol version; when provided, must match NFC_PAYLOAD_VERSION. */
  version?: string;
  signature: string;
}

export interface NFCControllerSnapshot {
  desks: DeskRecord[];
  seenNonces: Array<[string, number]>;
  revokedTags: string[];
  totalCheckIns: number;
  totalCheckOuts: number;
  totalAutoReleases: number;
  rejectedTaps: number;
}

export interface DeskRecord {
  deskId: string;
  secretKey: string;
  state: DeskState;
  activeUserId?: string;
  activeTagUid?: string;
  checkInTimestamp?: number;
  lastPresenceTimestamp?: number;
  awaySinceTimestamp?: number;
  autoReleaseGraceMs: number;
}

export interface NFCDeskMetrics {
  totalDesks: number;
  availableDesks: number;
  occupiedDesks: number;
  awayDesks: number;
  maintenanceDesks: number;
  totalCheckIns: number;
  totalCheckOuts: number;
  totalAutoReleases: number;
  rejectedTaps: number;
}

export interface NFCDeskControllerConfig {
  maxClockSkewMs?: number; // Maximum clock drift allowed for NFC taps (default 30s)
  defaultGracePeriodMs?: number; // Default grace period for away status (default 15 mins)
  nonceCacheTtlMs?: number; // Nonce replay cache retention (default 60s)
}

export class NFCDeskCheckinController {
  private maxClockSkewMs: number;
  private defaultGracePeriodMs: number;
  private nonceCacheTtlMs: number;

  private desks: Map<string, DeskRecord> = new Map();
  private seenNonces: Map<string, number> = new Map(); // nonce -> timestamp
  private revokedTags: Set<string> = new Set();

  // Telemetry metrics
  private totalCheckIns = 0;
  private totalCheckOuts = 0;
  private totalAutoReleases = 0;
  private rejectedTaps = 0;

  // Lifecycle Callbacks
  public onDeskCheckin?: (deskId: string, userId: string, timestamp: number) => void;
  public onDeskCheckout?: (deskId: string, userId: string, durationMs: number) => void;
  public onDeskAutoReleased?: (deskId: string, previousUserId: string) => void;
  public onUnauthorizedTap?: (deskId: string, reason: string) => void;
  /** Fires for every rejected check-in tap (bad signature, maintenance, occupied). */
  public onTapRejected?: (deskId: string, reason: string) => void;

  constructor(config: NFCDeskControllerConfig = {}) {
    this.maxClockSkewMs = config.maxClockSkewMs ?? 30000;
    this.defaultGracePeriodMs = config.defaultGracePeriodMs ?? 15 * 60 * 1000;
    this.nonceCacheTtlMs = config.nonceCacheTtlMs ?? 60000;
  }

  /**
   * Registers a desk in the venue IoT registry with its private HMAC secret key.
   */
  public registerDesk(deskId: string, secretKey: string, autoReleaseGraceMs?: number): void {
    this.desks.set(deskId, {
      deskId,
      secretKey,
      state: DeskState.AVAILABLE,
      autoReleaseGraceMs: autoReleaseGraceMs ?? this.defaultGracePeriodMs,
    });
  }

  /** Revokes an NFC tag UID so previously valid MACs can no longer authenticate. */
  public revokeTag(tagUid: string): void {
    this.revokedTags.add(tagUid);
  }

  /** Re-enables a previously revoked NFC tag UID. */
  public enrollTag(tagUid: string): void {
    this.revokedTags.delete(tagUid);
  }

  /** Rotates the HMAC secret key for a registered desk immediately. */
  public rotateDeskKey(deskId: string, newSecretKey: string): boolean {
    const desk = this.desks.get(deskId);
    if (!desk) return false;
    desk.secretKey = newSecretKey;
    return true;
  }

  /** Exports controller state for durable persistence across restarts. */
  public exportState(): NFCControllerSnapshot {
    return {
      desks: Array.from(this.desks.values()).map((d) => ({ ...d })),
      seenNonces: Array.from(this.seenNonces.entries()),
      revokedTags: Array.from(this.revokedTags.values()),
      totalCheckIns: this.totalCheckIns,
      totalCheckOuts: this.totalCheckOuts,
      totalAutoReleases: this.totalAutoReleases,
      rejectedTaps: this.rejectedTaps,
    };
  }

  /** Restores controller state from a previously exported durable snapshot. */
  public restoreState(snapshot: NFCControllerSnapshot): void {
    this.desks = new Map(snapshot.desks.map((d) => [d.deskId, { ...d }]));
    this.seenNonces = new Map(snapshot.seenNonces);
    this.revokedTags = new Set(snapshot.revokedTags);
    this.totalCheckIns = snapshot.totalCheckIns;
    this.totalCheckOuts = snapshot.totalCheckOuts;
    this.totalAutoReleases = snapshot.totalAutoReleases;
    this.rejectedTaps = snapshot.rejectedTaps;
  }

  /**
   * Processes an NFC tap payload to check into a desk.
   */
  public checkIn(
    payload: NFCTapPayload,
    currentTimeMs: number = Date.now()
  ): { success: boolean; state: DeskState; error?: string } {
    const authResult = this.verifyTapPayload(payload, currentTimeMs, 'checkin');
    if (!authResult.valid) {
      this.rejectedTaps++;
      if (this.onUnauthorizedTap) {
        this.onUnauthorizedTap(payload.deskId, authResult.error ?? 'Authentication failed');
      }
      this.onTapRejected?.(payload.deskId, authResult.error ?? 'Authentication failed');
      return { success: false, state: DeskState.AVAILABLE, error: authResult.error };
    }

    const desk = this.desks.get(payload.deskId)!;

    if (desk.state === DeskState.MAINTENANCE) {
      this.rejectedTaps++;
      this.onTapRejected?.(payload.deskId, 'Desk is under maintenance');
      return { success: false, state: desk.state, error: 'Desk is under maintenance' };
    }

    if (desk.state === DeskState.OCCUPIED && desk.activeUserId !== payload.userId) {
      this.rejectedTaps++;
      this.onTapRejected?.(
        payload.deskId,
        `Desk is already occupied by user ${desk.activeUserId}`
      );
      return {
        success: false,
        state: desk.state,
        error: `Desk is already occupied by user ${desk.activeUserId}`,
      };
    }

    // Check-in or return from away
    desk.state = DeskState.OCCUPIED;
    desk.activeUserId = payload.userId;
    desk.activeTagUid = payload.tagUid;
    desk.checkInTimestamp = desk.checkInTimestamp ?? currentTimeMs;
    desk.lastPresenceTimestamp = currentTimeMs;
    desk.awaySinceTimestamp = undefined;

    this.totalCheckIns++;

    if (this.onDeskCheckin) {
      this.onDeskCheckin(desk.deskId, payload.userId, currentTimeMs);
    }

    return { success: true, state: desk.state };
  }

  /**
   * Processes an NFC tap payload to check out from a desk.
   */
  public checkOut(
    payload: NFCTapPayload,
    currentTimeMs: number = Date.now()
  ): { success: boolean; state: DeskState; sessionDurationMs?: number; error?: string } {
    const authResult = this.verifyTapPayload(payload, currentTimeMs, 'checkout');
    if (!authResult.valid) {
      this.rejectedTaps++;
      return { success: false, state: DeskState.AVAILABLE, error: authResult.error };
    }

    const desk = this.desks.get(payload.deskId)!;

    if (desk.state === DeskState.AVAILABLE) {
      return { success: false, state: desk.state, error: 'Desk is already available' };
    }

    if (desk.activeUserId !== payload.userId) {
      this.rejectedTaps++;
      return {
        success: false,
        state: desk.state,
        error: 'Only the active checked-in user can check out',
      };
    }

    const sessionDurationMs = currentTimeMs - (desk.checkInTimestamp ?? currentTimeMs);
    const userId = desk.activeUserId;

    desk.state = DeskState.AVAILABLE;
    desk.activeUserId = undefined;
    desk.activeTagUid = undefined;
    desk.checkInTimestamp = undefined;
    desk.lastPresenceTimestamp = undefined;
    desk.awaySinceTimestamp = undefined;

    this.totalCheckOuts++;

    if (this.onDeskCheckout) {
      this.onDeskCheckout(desk.deskId, userId, sessionDurationMs);
    }

    return { success: true, state: desk.state, sessionDurationMs };
  }

  /**
   * Updates presence from hardware sensors (PIR motion, pressure mat, or BLE beacon).
   */
  public reportPresence(
    deskId: string,
    isPresent: boolean,
    currentTimeMs: number = Date.now()
  ): DeskState {
    const desk = this.desks.get(deskId);
    if (!desk || desk.state === DeskState.AVAILABLE || desk.state === DeskState.MAINTENANCE) {
      return desk?.state ?? DeskState.AVAILABLE;
    }

    if (isPresent) {
      desk.lastPresenceTimestamp = currentTimeMs;
      if (desk.state === DeskState.TEMPORARILY_AWAY) {
        desk.state = DeskState.OCCUPIED;
        desk.awaySinceTimestamp = undefined;
      }
    } else {
      if (desk.state === DeskState.OCCUPIED) {
        desk.state = DeskState.TEMPORARILY_AWAY;
        desk.awaySinceTimestamp = currentTimeMs;
      }
    }

    return desk.state;
  }

  /**
   * Scans all desks and automatically releases any desks whose away grace period has expired.
   */
  public checkExpiredDesks(currentTimeMs: number = Date.now()): string[] {
    const released: string[] = [];

    for (const [deskId, desk] of this.desks.entries()) {
      if (desk.state === DeskState.TEMPORARILY_AWAY && desk.awaySinceTimestamp) {
        const awayDuration = currentTimeMs - desk.awaySinceTimestamp;
        if (awayDuration >= desk.autoReleaseGraceMs) {
          const prevUser = desk.activeUserId ?? 'unknown';

          desk.state = DeskState.AVAILABLE;
          desk.activeUserId = undefined;
          desk.activeTagUid = undefined;
          desk.checkInTimestamp = undefined;
          desk.lastPresenceTimestamp = undefined;
          desk.awaySinceTimestamp = undefined;

          this.totalAutoReleases++;
          released.push(deskId);

          if (this.onDeskAutoReleased) {
            this.onDeskAutoReleased(deskId, prevUser);
          }
        }
      }
    }

    return released;
  }

  /**
   * Computes an HMAC-SHA256 signature over a canonical payload string.
   *
   * Canonical format (fields separated by '\n' to avoid ambiguity):
   *   version\ntagUid\nuserId\ndeskId\noperation\ntimestamp\nnonce
   *
   * Returns the full lowercase hex digest (64 characters).
   */
  public computeTapSignature(
    secretKey: string,
    tagUid: string,
    userId: string,
    deskId: string,
    operation: TapOperation,
    timestamp: number,
    nonce: string
  ): string {
    const canonical = [
      NFC_PAYLOAD_VERSION,
      tagUid,
      userId,
      deskId,
      operation,
      String(timestamp),
      nonce,
    ].join('\n');
    return createHmac('sha256', secretKey).update(canonical, 'utf8').digest('hex');
  }

  public getDeskStatus(deskId: string): DeskRecord | undefined {
    return this.desks.get(deskId);
  }

  public getMetrics(): NFCDeskMetrics {
    let availableDesks = 0;
    let occupiedDesks = 0;
    let awayDesks = 0;
    let maintenanceDesks = 0;

    for (const desk of this.desks.values()) {
      switch (desk.state) {
        case DeskState.AVAILABLE:
          availableDesks++;
          break;
        case DeskState.OCCUPIED:
          occupiedDesks++;
          break;
        case DeskState.TEMPORARILY_AWAY:
          awayDesks++;
          break;
        case DeskState.MAINTENANCE:
          maintenanceDesks++;
          break;
      }
    }

    return {
      totalDesks: this.desks.size,
      availableDesks,
      occupiedDesks,
      awayDesks,
      maintenanceDesks,
      totalCheckIns: this.totalCheckIns,
      totalCheckOuts: this.totalCheckOuts,
      totalAutoReleases: this.totalAutoReleases,
      rejectedTaps: this.rejectedTaps,
    };
  }

  // --- Internal Tap Verification ---

  /**
   * Verifies a tap payload.
   *
   * Security invariant: nonce is NOT written to `seenNonces` until AFTER
   * the cryptographic signature has been validated. This ensures that an
   * invalid request cannot exhaust the nonce space.
   *
   * @param payload   The incoming NFC tap payload.
   * @param currentTimeMs  Wall-clock time for freshness and nonce-TTL checks.
   * @param expectedOperation  The operation the caller intends (checkin|checkout).
   */
  private verifyTapPayload(
    payload: NFCTapPayload,
    currentTimeMs: number,
    expectedOperation?: TapOperation
  ): { valid: boolean; error?: string } {
    const desk = this.desks.get(payload.deskId);
    if (!desk) {
      return { valid: false, error: `Desk ${payload.deskId} is not registered` };
    }

    if (payload.version !== undefined && payload.version !== NFC_PAYLOAD_VERSION) {
      return { valid: false, error: `Unsupported protocol version: ${payload.version}` };
    }

    if (this.revokedTags.has(payload.tagUid)) {
      return { valid: false, error: `NFC tag ${payload.tagUid} has been revoked` };
    }

    // 1. Timestamp Freshness Guard (Anti-Relay)
    const drift = Math.abs(currentTimeMs - payload.timestamp);
    if (drift > this.maxClockSkewMs) {
      return {
        valid: false,
        error: `Timestamp drift ${drift}ms exceeds max clock skew of ${this.maxClockSkewMs}ms`,
      };
    }

    // 2. Operation binding check (prevents cross-operation replay)
    const operation: TapOperation = payload.operation;
    if (expectedOperation && operation !== expectedOperation) {
      return {
        valid: false,
        error: `Operation mismatch: expected '${expectedOperation}', got '${operation}'`,
      };
    }

    // 3. Cryptographic Signature Validation — BEFORE nonce consumption.
    //    Using timingSafeEqual to prevent timing side-channels.
    const expectedSig = this.computeTapSignature(
      desk.secretKey,
      payload.tagUid,
      payload.userId,
      payload.deskId,
      operation,
      payload.timestamp,
      payload.nonce
    );

    let sigValid: boolean;
    try {
      const expected = Buffer.from(expectedSig, 'hex');
      const received = Buffer.from(payload.signature, 'hex');
      sigValid =
        expected.length === received.length && timingSafeEqual(expected, received);
    } catch {
      // Buffer.from throws if signature is not valid hex or unexpected length.
      sigValid = false;
    }

    if (!sigValid) {
      return { valid: false, error: 'Invalid cryptographic NFC signature' };
    }

    // 4. Nonce Replay Prevention Guard — only reached on valid signature.
    this.cleanExpiredNonces(currentTimeMs);
    if (this.seenNonces.has(payload.nonce)) {
      return { valid: false, error: `Replay attack detected: nonce ${payload.nonce} was already used` };
    }
    // Commit nonce only after all validations pass.
    this.seenNonces.set(payload.nonce, currentTimeMs);

    return { valid: true };
  }

  private cleanExpiredNonces(now: number): void {
    for (const [nonce, ts] of this.seenNonces.entries()) {
      if (now - ts > this.nonceCacheTtlMs) {
        this.seenNonces.delete(nonce);
      }
    }
  }
}
