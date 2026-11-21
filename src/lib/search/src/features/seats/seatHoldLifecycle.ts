export type SeatHoldStatus = 'HELD' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED';

export interface SeatHoldRecord {
  seatId: string;
  userId: string;
  holdToken: string;
  status: SeatHoldStatus;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  bookingId?: string;
}

export interface HoldMutationResult {
  ok: boolean;
  code:
    | 'OK'
    | 'ALREADY_RELEASED'
    | 'NOT_FOUND'
    | 'INVALID_TOKEN'
    | 'EXPIRED'
    | 'INVALID_STATE';
  record?: SeatHoldRecord;
}

let tokenCounter = 0;

function generateHoldToken(seatId: string, now: number): string {
  tokenCounter += 1;
  return `hold_${seatId}_${now}_${tokenCounter}`;
}

export class SeatHoldLifecycleManager {
  private readonly holds = new Map<string, SeatHoldRecord>();

  createHold(
    seatId: string,
    userId: string,
    ttlMs = 600_000,
    now = Date.now()
  ): HoldMutationResult {
    const current = this.holds.get(seatId);
    if (current) {
      if (current.status === 'CONFIRMED') {
        return { ok: false, code: 'INVALID_STATE', record: { ...current } };
      }
      if (current.status === 'HELD' && now < current.expiresAt) {
        return { ok: false, code: 'INVALID_STATE', record: { ...current } };
      }
    }

    const record: SeatHoldRecord = {
      seatId,
      userId,
      holdToken: generateHoldToken(seatId, now),
      status: 'HELD',
      createdAt: now,
      expiresAt: now + Math.max(1, ttlMs),
      updatedAt: now,
    };

    this.holds.set(seatId, record);
    return { ok: true, code: 'OK', record: { ...record } };
  }

  confirmHold(
    seatId: string,
    holdToken: string,
    bookingId: string,
    now = Date.now()
  ): HoldMutationResult {
    const current = this.holds.get(seatId);
    if (!current) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (current.holdToken !== holdToken) {
      return { ok: false, code: 'INVALID_TOKEN', record: { ...current } };
    }
    if (current.status === 'EXPIRED' || now >= current.expiresAt) {
      if (current.status === 'HELD') {
        const expiredRecord: SeatHoldRecord = {
          ...current,
          status: 'EXPIRED',
          updatedAt: now,
        };
        this.holds.set(seatId, expiredRecord);
        return { ok: false, code: 'EXPIRED', record: { ...expiredRecord } };
      }
      return { ok: false, code: 'EXPIRED', record: { ...current } };
    }
    if (current.status !== 'HELD') {
      return { ok: false, code: 'INVALID_STATE', record: { ...current } };
    }

    const confirmed: SeatHoldRecord = {
      ...current,
      status: 'CONFIRMED',
      bookingId,
      updatedAt: now,
    };
    this.holds.set(seatId, confirmed);
    return { ok: true, code: 'OK', record: { ...confirmed } };
  }

  releaseHold(
    seatId: string,
    holdToken: string,
    now = Date.now()
  ): HoldMutationResult {
    const current = this.holds.get(seatId);
    if (!current) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (current.holdToken !== holdToken) {
      return { ok: false, code: 'INVALID_TOKEN', record: { ...current } };
    }
    if (current.status === 'CONFIRMED') {
      return { ok: false, code: 'INVALID_STATE', record: { ...current } };
    }
    if (current.status === 'RELEASED' || current.status === 'EXPIRED') {
      return { ok: true, code: 'ALREADY_RELEASED', record: { ...current } };
    }

    const released: SeatHoldRecord = {
      ...current,
      status: 'RELEASED',
      updatedAt: now,
    };
    this.holds.set(seatId, released);
    return { ok: true, code: 'OK', record: { ...released } };
  }

  sweepExpiredHolds(now = Date.now()): SeatHoldRecord[] {
    const expiredNow: SeatHoldRecord[] = [];

    for (const [seatId, record] of this.holds.entries()) {
      if (record.status === 'HELD' && record.expiresAt <= now) {
        const updated: SeatHoldRecord = {
          ...record,
          status: 'EXPIRED',
          updatedAt: now,
        };
        this.holds.set(seatId, updated);
        expiredNow.push({ ...updated });
      }
    }

    return expiredNow;
  }

  getHold(seatId: string): SeatHoldRecord | undefined {
    const record = this.holds.get(seatId);
    return record ? { ...record } : undefined;
  }
}