export interface SeatHoldLease {
  seatId: string;
  holderId: string;
  acquiredAtMs: number;
  expiresAtMs: number;
  fenceToken: number;
}

export interface AcquireLeaseResult {
  acquired: true;
  renewed: boolean;
  lease: SeatHoldLease;
}

export interface LeaseConflictErrorPayload {
  code: 'SEAT_LOCK_CONFLICT';
  seatId: string;
  currentHolderId: string;
  retryAfterMs: number;
  expiresAtMs: number;
}

export class SeatLockConflictError extends Error {
  public readonly code = 'SEAT_LOCK_CONFLICT' as const;
  public readonly seatId: string;
  public readonly currentHolderId: string;
  public readonly retryAfterMs: number;
  public readonly expiresAtMs: number;

  constructor(payload: LeaseConflictErrorPayload, message?: string) {
    super(
      message ??
        `Seat "${payload.seatId}" is currently held by "${payload.currentHolderId}". Retry after ${payload.retryAfterMs}ms.`
    );
    this.name = 'SeatLockConflictError';
    this.seatId = payload.seatId;
    this.currentHolderId = payload.currentHolderId;
    this.retryAfterMs = payload.retryAfterMs;
    this.expiresAtMs = payload.expiresAtMs;
  }

  public toPayload(): LeaseConflictErrorPayload {
    return {
      code: this.code,
      seatId: this.seatId,
      currentHolderId: this.currentHolderId,
      retryAfterMs: this.retryAfterMs,
      expiresAtMs: this.expiresAtMs,
    };
  }
}

export class SeatReservationLockManager {
  private readonly defaultTtlMs: number;
  private readonly nowFn: () => number;
  private readonly activeLeases = new Map<string, SeatHoldLease>();
  private readonly fenceCounters = new Map<string, number>();

  constructor(
    options: {
      defaultTtlMs?: number;
      nowFn?: () => number;
    } = {}
  ) {
    this.defaultTtlMs =
      typeof options.defaultTtlMs === 'number' &&
      Number.isFinite(options.defaultTtlMs) &&
      options.defaultTtlMs > 0
        ? Math.floor(options.defaultTtlMs)
        : 120_000;
    this.nowFn = options.nowFn ?? Date.now;
  }

  private nextFenceToken(seatId: string): number {
    const current = this.fenceCounters.get(seatId) ?? 0;
    const next = current + 1;
    this.fenceCounters.set(seatId, next);
    return next;
  }

  public isLeaseExpired(lease: SeatHoldLease, nowMs = this.nowFn()): boolean {
    return nowMs >= lease.expiresAtMs;
  }

  public getActiveLease(
    seatId: string,
    nowMs = this.nowFn()
  ): SeatHoldLease | null {
    const lease = this.activeLeases.get(seatId);
    if (!lease) return null;
    if (this.isLeaseExpired(lease, nowMs)) {
      this.activeLeases.delete(seatId);
      return null;
    }
    return { ...lease };
  }

  public acquireOrRenew(
    seatId: string,
    holderId: string,
    options: {
      ttlMs?: number;
      nowMs?: number;
    } = {}
  ): AcquireLeaseResult {
    if (!seatId || typeof seatId !== 'string') {
      throw new Error('seatId is required');
    }
    if (!holderId || typeof holderId !== 'string') {
      throw new Error('holderId is required');
    }

    const nowMs = options.nowMs ?? this.nowFn();
    const ttlMs =
      typeof options.ttlMs === 'number' &&
      Number.isFinite(options.ttlMs) &&
      options.ttlMs > 0
        ? Math.floor(options.ttlMs)
        : this.defaultTtlMs;

    const existing = this.activeLeases.get(seatId);
    if (existing && !this.isLeaseExpired(existing, nowMs)) {
      if (existing.holderId === holderId) {
        const renewedLease: SeatHoldLease = {
          ...existing,
          expiresAtMs: nowMs + ttlMs,
        };
        this.activeLeases.set(seatId, renewedLease);
        return {
          acquired: true,
          renewed: true,
          lease: { ...renewedLease },
        };
      }

      const retryAfterMs = Math.max(0, existing.expiresAtMs - nowMs);
      throw new SeatLockConflictError({
        code: 'SEAT_LOCK_CONFLICT',
        seatId,
        currentHolderId: existing.holderId,
        retryAfterMs,
        expiresAtMs: existing.expiresAtMs,
      });
    }

    const newLease: SeatHoldLease = {
      seatId,
      holderId,
      acquiredAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
      fenceToken: this.nextFenceToken(seatId),
    };
    this.activeLeases.set(seatId, newLease);

    return {
      acquired: true,
      renewed: false,
      lease: { ...newLease },
    };
  }

  public releaseLease(
    seatId: string,
    holderId: string,
    nowMs = this.nowFn()
  ): boolean {
    const existing = this.activeLeases.get(seatId);
    if (!existing) return false;

    if (this.isLeaseExpired(existing, nowMs)) {
      this.activeLeases.delete(seatId);
      return false;
    }

    if (existing.holderId !== holderId) {
      const retryAfterMs = Math.max(0, existing.expiresAtMs - nowMs);
      throw new SeatLockConflictError(
        {
          code: 'SEAT_LOCK_CONFLICT',
          seatId,
          currentHolderId: existing.holderId,
          retryAfterMs,
          expiresAtMs: existing.expiresAtMs,
        },
        `Holder "${holderId}" cannot release seat "${seatId}" owned by "${existing.holderId}"`
      );
    }

    this.activeLeases.delete(seatId);
    return true;
  }

  public sweepExpired(nowMs = this.nowFn()): number {
    let swept = 0;
    for (const [seatId, lease] of this.activeLeases.entries()) {
      if (this.isLeaseExpired(lease, nowMs)) {
        this.activeLeases.delete(seatId);
        swept += 1;
      }
    }
    return swept;
  }
}
