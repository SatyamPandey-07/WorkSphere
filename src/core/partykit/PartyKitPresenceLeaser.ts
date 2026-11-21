/**
 * @file PartyKitPresenceLeaser.ts
 * @description Real-time multi-room presence clustering, CAS-based ephemeral seat lease locks,
 * monotonic resync epochs, and heartbeat eviction for PartyKit edge rooms.
 */

export const LeaseState = {
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  LEASED: 'LEASED',
  EXPIRED: 'EXPIRED',
} as const;

export type LeaseStateType = typeof LeaseState[keyof typeof LeaseState];

export const UserPresenceStatus = {
  ACTIVE: 'ACTIVE',
  IDLE: 'IDLE',
  AWAY: 'AWAY',
  OFFLINE: 'OFFLINE',
} as const;

export type UserPresenceStatusType = typeof UserPresenceStatus[keyof typeof UserPresenceStatus];

export interface SeatLease {
  seatId: string;
  roomId: string;
  tenantId?: string;
  tenantName?: string;
  state: LeaseStateType;
  leaseExpiresAt: number;
  version: number; // Compare-And-Swap version counter
  lastHeartbeat: number;
}

export interface UserPresence {
  userId: string;
  userName: string;
  roomId: string;
  currentSeatId?: string;
  status: UserPresenceStatusType;
  clientCapabilities: string[];
  lastActiveAt: number;
  connectionId: string;
}

export const DeltaEventType = {
  PRESENCE_JOIN: 'PRESENCE_JOIN',
  PRESENCE_LEAVE: 'PRESENCE_LEAVE',
  HEARTBEAT: 'HEARTBEAT',
  SEAT_ACQUIRED: 'SEAT_ACQUIRED',
  SEAT_RELEASED: 'SEAT_RELEASED',
  SEAT_EXPIRED: 'SEAT_EXPIRED',
  SEAT_HELD: 'SEAT_HELD',
} as const;

export type DeltaEventTypeKey = typeof DeltaEventType[keyof typeof DeltaEventType];

export interface RoomDeltaEvent {
  sequenceId: number;
  epoch: number;
  timestamp: number;
  eventType: DeltaEventTypeKey;
  payload: Record<string, unknown>;
}

export interface LeaserConfig {
  defaultLeaseTtlMs?: number; // e.g. 15 * 60 * 1000 (15 min)
  heartbeatTimeoutMs?: number; // e.g. 30 * 1000 (30 sec)
  holdTtlMs?: number; // e.g. 60 * 1000 (60 sec)
  maxRoomCapacity?: number;
}

export class PartyKitPresenceLeaser {
  private _roomId: string;
  private _epoch: number;
  private _sequenceCounter: number;
  private _users: Map<string, UserPresence>;
  private _seats: Map<string, SeatLease>;
  private _eventHistory: RoomDeltaEvent[];
  private _defaultLeaseTtlMs: number;
  private _heartbeatTimeoutMs: number;
  private _holdTtlMs: number;
  private _maxRoomCapacity: number;

  constructor(roomId: string, config?: LeaserConfig) {
    this._roomId = roomId;
    this._epoch = Date.now();
    this._sequenceCounter = 0;
    this._users = new Map();
    this._seats = new Map();
    this._eventHistory = [];
    this._defaultLeaseTtlMs = config?.defaultLeaseTtlMs ?? 15 * 60 * 1000;
    this._heartbeatTimeoutMs = config?.heartbeatTimeoutMs ?? 30 * 1000;
    this._holdTtlMs = config?.holdTtlMs ?? 60 * 1000;
    this._maxRoomCapacity = config?.maxRoomCapacity ?? 50;
  }

  public get roomId(): string {
    return this._roomId;
  }

  public get epoch(): number {
    return this._epoch;
  }

  public get currentSequenceId(): number {
    return this._sequenceCounter;
  }

  /**
   * Registers a desk/seat in the room catalog.
   */
  public registerSeat(seatId: string): void {
    if (!this._seats.has(seatId)) {
      this._seats.set(seatId, {
        seatId,
        roomId: this._roomId,
        state: LeaseState.AVAILABLE,
        leaseExpiresAt: 0,
        version: 1,
        lastHeartbeat: 0,
      });
    }
  }

  /**
   * Records a user joining the room presence cluster.
   */
  public joinRoom(params: {
    userId: string;
    userName: string;
    connectionId: string;
    clientCapabilities?: string[];
    timestamp?: number;
  }): RoomDeltaEvent {
    if (this._users.size >= this._maxRoomCapacity && !this._users.has(params.userId)) {
      throw new Error(`Room '${this._roomId}' is at maximum capacity (${this._maxRoomCapacity}).`);
    }

    const now = params.timestamp ?? Date.now();
    const presence: UserPresence = {
      userId: params.userId,
      userName: params.userName,
      roomId: this._roomId,
      status: UserPresenceStatus.ACTIVE,
      clientCapabilities: params.clientCapabilities ?? ['hotdesk', 'chat'],
      lastActiveAt: now,
      connectionId: params.connectionId,
    };

    this._users.set(params.userId, presence);

    return this.emitEvent(DeltaEventType.PRESENCE_JOIN, {
      userId: presence.userId,
      userName: presence.userName,
      status: presence.status,
      connectionId: presence.connectionId,
    }, now);
  }

  /**
   * Records a user leaving the room, releasing any active seat lease.
   */
  public leaveRoom(userId: string, timestamp?: number): RoomDeltaEvent | null {
    const user = this._users.get(userId);
    if (!user) return null;

    const now = timestamp ?? Date.now();
    if (user.currentSeatId) {
      this.releaseSeat(user.currentSeatId, userId, now);
    }

    this._users.delete(userId);

    return this.emitEvent(DeltaEventType.PRESENCE_LEAVE, {
      userId,
      userName: user.userName,
    }, now);
  }

  /**
   * Refreshes client heartbeat to keep presence and seat leases alive.
   */
  public heartbeat(userId: string, timestamp?: number): { success: boolean; refreshedSeatId?: string } {
    const now = timestamp ?? Date.now();
    const user = this._users.get(userId);
    if (!user) {
      return { success: false };
    }

    user.lastActiveAt = now;
    user.status = UserPresenceStatus.ACTIVE;

    let refreshedSeatId: string | undefined;
    if (user.currentSeatId) {
      const lease = this._seats.get(user.currentSeatId);
      if (lease && lease.tenantId === userId && lease.state === LeaseState.LEASED) {
        lease.lastHeartbeat = now;
        lease.leaseExpiresAt = now + this._defaultLeaseTtlMs;
        refreshedSeatId = lease.seatId;
      }
    }

    return { success: true, refreshedSeatId };
  }

  /**
   * Places a short-lived temporary hold on a seat before formal confirmation.
   */
  public holdSeat(seatId: string, userId: string, holdDurationMs?: number, timestamp?: number): {
    success: boolean;
    lease?: SeatLease;
    error?: string;
  } {
    const now = timestamp ?? Date.now();
    const lease = this._seats.get(seatId);
    if (!lease) {
      return { success: false, error: `Seat '${seatId}' not found.` };
    }

    const user = this._users.get(userId);
    if (!user) {
      return { success: false, error: `User '${userId}' not present in room.` };
    }

    // Check if available or if expired hold
    const isAvailable = lease.state === LeaseState.AVAILABLE ||
      lease.state === LeaseState.EXPIRED ||
      (lease.state === LeaseState.HELD && lease.leaseExpiresAt < now);

    if (!isAvailable && lease.tenantId !== userId) {
      return { success: false, error: `Seat '${seatId}' is currently ${lease.state} by another tenant.` };
    }

    const ttl = holdDurationMs ?? this._holdTtlMs;
    lease.state = LeaseState.HELD;
    lease.tenantId = userId;
    lease.tenantName = user.userName;
    lease.leaseExpiresAt = now + ttl;
    lease.lastHeartbeat = now;
    lease.version += 1;

    this.emitEvent(DeltaEventType.SEAT_HELD, {
      seatId,
      userId,
      leaseExpiresAt: lease.leaseExpiresAt,
      version: lease.version,
    }, now);

    return { success: true, lease: { ...lease } };
  }

  /**
   * Atomically acquires or extends a seat lease with optimistic concurrency CAS check.
   */
  public acquireSeat(
    seatId: string,
    userId: string,
    expectedVersion?: number,
    leaseTtlMs?: number,
    timestamp?: number
  ): { success: boolean; lease?: SeatLease; error?: string } {
    const now = timestamp ?? Date.now();
    const lease = this._seats.get(seatId);
    if (!lease) {
      return { success: false, error: `Seat '${seatId}' not found.` };
    }

    const user = this._users.get(userId);
    if (!user) {
      return { success: false, error: `User '${userId}' not present in room.` };
    }

    // CAS optimistic concurrency check
    if (expectedVersion !== undefined && lease.version !== expectedVersion) {
      return {
        success: false,
        error: `CAS Version Mismatch: expected v${expectedVersion}, current is v${lease.version}`,
      };
    }

    // Check if seat is claimable
    const canAcquire =
      lease.state === LeaseState.AVAILABLE ||
      lease.state === LeaseState.EXPIRED ||
      (lease.state === LeaseState.HELD && (lease.tenantId === userId || lease.leaseExpiresAt < now)) ||
      (lease.state === LeaseState.LEASED && lease.tenantId === userId);

    if (!canAcquire) {
      return { success: false, error: `Seat '${seatId}' is already occupied.` };
    }

    // If user already owns another seat, release it
    if (user.currentSeatId && user.currentSeatId !== seatId) {
      this.releaseSeat(user.currentSeatId, userId, now);
    }

    const ttl = leaseTtlMs ?? this._defaultLeaseTtlMs;
    lease.state = LeaseState.LEASED;
    lease.tenantId = userId;
    lease.tenantName = user.userName;
    lease.leaseExpiresAt = now + ttl;
    lease.lastHeartbeat = now;
    lease.version += 1;

    user.currentSeatId = seatId;

    this.emitEvent(DeltaEventType.SEAT_ACQUIRED, {
      seatId,
      userId,
      leaseExpiresAt: lease.leaseExpiresAt,
      version: lease.version,
    }, now);

    return { success: true, lease: { ...lease } };
  }

  /**
   * Explicitly releases a seat lease back into the available pool.
   */
  public releaseSeat(seatId: string, userId: string, timestamp?: number): { success: boolean; error?: string } {
    const now = timestamp ?? Date.now();
    const lease = this._seats.get(seatId);
    if (!lease) {
      return { success: false, error: `Seat '${seatId}' not found.` };
    }

    if (lease.tenantId !== userId && lease.state !== LeaseState.AVAILABLE) {
      return { success: false, error: `User '${userId}' does not own lease for seat '${seatId}'.` };
    }

    lease.state = LeaseState.AVAILABLE;
    lease.tenantId = undefined;
    lease.tenantName = undefined;
    lease.leaseExpiresAt = 0;
    lease.version += 1;

    const user = this._users.get(userId);
    if (user && user.currentSeatId === seatId) {
      user.currentSeatId = undefined;
    }

    this.emitEvent(DeltaEventType.SEAT_RELEASED, {
      seatId,
      userId,
      version: lease.version,
    }, now);

    return { success: true };
  }

  /**
   * Evaluates time-stamps to evict offline presences and expire inactive seat leases.
   */
  public sweepStaleLeasesAndPresence(currentTime?: number): {
    expiredSeats: string[];
    evictedUsers: string[];
  } {
    const now = currentTime ?? Date.now();
    const expiredSeats: string[] = [];
    const evictedUsers: string[] = [];

    // 1. Sweep stale leases
    for (const [seatId, lease] of this._seats) {
      if (
        (lease.state === LeaseState.LEASED || lease.state === LeaseState.HELD) &&
        lease.leaseExpiresAt > 0 &&
        lease.leaseExpiresAt <= now
      ) {
        const previousTenant = lease.tenantId;
        lease.state = LeaseState.AVAILABLE;
        lease.tenantId = undefined;
        lease.tenantName = undefined;
        lease.leaseExpiresAt = 0;
        lease.version += 1;

        if (previousTenant) {
          const user = this._users.get(previousTenant);
          if (user && user.currentSeatId === seatId) {
            user.currentSeatId = undefined;
          }
        }

        expiredSeats.push(seatId);
        this.emitEvent(DeltaEventType.SEAT_EXPIRED, {
          seatId,
          previousTenant,
          version: lease.version,
        }, now);
      }
    }

    // 2. Sweep inactive user presence
    for (const [userId, user] of this._users) {
      if (now - user.lastActiveAt > this._heartbeatTimeoutMs) {
        if (user.currentSeatId) {
          this.releaseSeat(user.currentSeatId, userId, now);
        }
        this._users.delete(userId);
        evictedUsers.push(userId);
        this.emitEvent(DeltaEventType.PRESENCE_LEAVE, {
          userId,
          reason: 'HEARTBEAT_TIMEOUT',
        }, now);
      }
    }

    return { expiredSeats, evictedUsers };
  }

  /**
   * Retrieves all delta events strictly greater than sinceSequenceId for gapless resync.
   */
  public getDeltasSince(sinceSequenceId: number): RoomDeltaEvent[] {
    return this._eventHistory.filter((e) => e.sequenceId > sinceSequenceId);
  }

  /**
   * Generates a complete snapshot of room state for initial hydration.
   */
  public getSnapshot(): {
    roomId: string;
    epoch: number;
    sequenceId: number;
    users: UserPresence[];
    seats: SeatLease[];
  } {
    return {
      roomId: this._roomId,
      epoch: this._epoch,
      sequenceId: this._sequenceCounter,
      users: Array.from(this._users.values()).map((u) => ({ ...u })),
      seats: Array.from(this._seats.values()).map((s) => ({ ...s })),
    };
  }

  private emitEvent(
    eventType: DeltaEventTypeKey,
    payload: Record<string, unknown>,
    timestamp: number
  ): RoomDeltaEvent {
    this._sequenceCounter += 1;
    const event: RoomDeltaEvent = {
      sequenceId: this._sequenceCounter,
      epoch: this._epoch,
      timestamp,
      eventType,
      payload,
    };
    this._eventHistory.push(event);
    if (this._eventHistory.length > 500) {
      this._eventHistory.shift(); // retain sliding window of 500 deltas
    }
    return event;
  }
}
