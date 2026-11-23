/**
 * SeatSyncCoordinator.ts
 *
 * Coordinates concurrency and monotonic state versioning between offline sync queue flush
 * and incoming WebSocket presence frames for venue seats (#7854).
 *
 * Provides:
 * 1. Per-venue/seat concurrency serialization (using withWebLock with fallback to in-memory mutex).
 * 2. In-flight reconciliation tracking (marks a venue/seat as reconciling during HTTP POST).
 * 3. Monotonic version tracking (tracks latest sequence/epoch/version per venue/seat).
 * 4. Stale WebSocket frame rejection during or after newer reconciliation.
 */

import { withWebLock } from "@/lib/webLock";

export interface SeatVersionTag {
  epoch: number;
  sequenceId: number;
  updatedAt: number;
}

export interface InFlightReconciliation {
  venueId: string;
  seatId?: string;
  startedAt: number;
  baselineEpoch: number;
  baselineSequenceId: number;
}

export class SeatSyncCoordinator {
  private static instance: SeatSyncCoordinator | null = null;

  // Track latest accepted authoritative server version tag per key (venueId or `${venueId}:${seatId}`)
  private serverVersions = new Map<string, SeatVersionTag>();

  // Track active in-flight reconciliations (e.g. HTTP POST in progress)
  private inFlightReconciliations = new Map<string, InFlightReconciliation>();

  // Track the timestamp of the most recent completed reconciliation
  private lastReconciliationTimestamps = new Map<string, number>();

  // In-memory per-key lock queue for environments where Web Locks are unavailable or as serialization helper
  private mutexChains = new Map<string, Promise<unknown>>();

  public static getInstance(): SeatSyncCoordinator {
    if (!SeatSyncCoordinator.instance) {
      SeatSyncCoordinator.instance = new SeatSyncCoordinator();
    }
    return SeatSyncCoordinator.instance;
  }

  public static resetInstance(): void {
    if (SeatSyncCoordinator.instance) {
      SeatSyncCoordinator.instance.serverVersions.clear();
      SeatSyncCoordinator.instance.inFlightReconciliations.clear();
      SeatSyncCoordinator.instance.lastReconciliationTimestamps.clear();
      SeatSyncCoordinator.instance.mutexChains.clear();
      SeatSyncCoordinator.instance = null;
    }
  }

  /**
   * Helper to format a composite key for a venue and optional seatId.
   */
  public getKey(venueId: string, seatId?: string): string {
    return seatId ? `${venueId}:${seatId}` : venueId;
  }

  /**
   * Generates a WebLock resource name scoped per venue and optional seat.
   */
  public getLockName(venueId: string, seatId?: string): string {
    return `worksphere-seat-sync:${this.getKey(venueId, seatId)}`;
  }

  /**
   * Acquires a serialized lock for the specified venue/seat and runs the critical section.
   * Leverages withWebLock with automatic fallback to in-memory serialization if Web Locks are unsupported or time out.
   */
  public async runWithSeatLock<T>(
    venueId: string,
    seatId: string | undefined,
    operation: () => Promise<T>,
    timeoutMs: number = 5000,
  ): Promise<T> {
    const key = this.getKey(venueId, seatId);
    const lockName = this.getLockName(venueId, seatId);

    // Fallback in-memory queue to guarantee execution order even when navigator.locks is missing
    const executeInMutex = async (): Promise<T> => {
      const currentChain = this.mutexChains.get(key) || Promise.resolve();
      let releaseMutex: () => void;
      const nextChain = new Promise<void>((resolve) => {
        releaseMutex = resolve;
      });

      this.mutexChains.set(
        key,
        currentChain.then(() => nextChain).catch(() => nextChain),
      );

      await currentChain;
      try {
        return await operation();
      } finally {
        releaseMutex!();
        if (this.mutexChains.get(key) === nextChain) {
          this.mutexChains.delete(key);
        }
      }
    };

    return withWebLock(() => executeInMutex(), lockName, {
      timeoutMs,
      fallbackOnTimeout: true,
    });
  }

  /**
   * Marks a venue/seat reconciliation as in-flight before the HTTP request begins.
   * Captures the baseline server sequence and epoch at the start of reconciliation.
   */
  public markReconciliationStart(venueId: string, seatId?: string): void {
    const key = this.getKey(venueId, seatId);
    const baseline =
      this.serverVersions.get(key) ||
      (seatId ? this.serverVersions.get(venueId) : undefined);
    this.inFlightReconciliations.set(key, {
      venueId,
      seatId,
      startedAt: Date.now(),
      baselineEpoch: baseline?.epoch ?? 0,
      baselineSequenceId: baseline?.sequenceId ?? 0,
    });
  }

  /**
   * Clears the in-flight reconciliation status upon HTTP completion (success or failure).
   */
  public markReconciliationEnd(venueId: string, seatId?: string): void {
    const key = this.getKey(venueId, seatId);
    this.inFlightReconciliations.delete(key);
    this.lastReconciliationTimestamps.set(key, Date.now());
  }

  /**
   * Checks whether a reconciliation is currently in-flight for this venue/seat.
   */
  public isReconciliationInFlight(venueId: string, seatId?: string): boolean {
    const key = this.getKey(venueId, seatId);
    if (this.inFlightReconciliations.has(key)) return true;
    if (seatId && this.inFlightReconciliations.has(venueId)) return true;
    return false;
  }

  /**
   * Records an authoritative server version tag for a venue/seat (from incoming server frames).
   */
  public recordServerVersion(
    venueId: string,
    seatId: string | undefined,
    epoch: number = 0,
    sequenceId: number = 0,
  ): void {
    const key = this.getKey(venueId, seatId);
    this.serverVersions.set(key, {
      epoch,
      sequenceId,
      updatedAt: Date.now(),
    });
  }

  /**
   * Checks whether an incoming WebSocket update is acceptable or should be discarded as stale.
   *
   * An update is rejected if:
   * 1. A reconciliation is in-flight for this venue/seat AND the incoming frame has an older or equal sequence
   *    relative to the baseline sequence that existed when reconciliation began (or has 0 epoch/sequence).
   * 2. The frame's epoch is lower than the latest accepted server epoch.
   * 3. The frame's epoch is equal to the latest epoch, but sequenceId <= latest accepted server sequenceId.
   *
   * Crucially, a frame with a higher server sequence than the baseline is ALWAYS accepted, even during or after
   * HTTP reconciliation, ensuring legitimate server events are never permanently discarded.
   */
  public shouldAcceptUpdate(
    venueId: string,
    seatId: string | undefined,
    frameEpoch: number = 0,
    frameSequenceId: number = 0,
  ): boolean {
    const key = this.getKey(venueId, seatId);
    const inFlight =
      this.inFlightReconciliations.get(key) ||
      (seatId ? this.inFlightReconciliations.get(venueId) : undefined);

    // If reconciliation is in-flight, protect optimistic local state from snapshots/replays that predate the reconciliation
    if (inFlight) {
      if (frameEpoch < inFlight.baselineEpoch) {
        return false;
      }
      if (
        frameEpoch === inFlight.baselineEpoch &&
        frameSequenceId <= inFlight.baselineSequenceId
      ) {
        return false;
      }
      // If frame has 0 epoch and 0 sequence (e.g. unsequenced stale connect snapshot), reject during in-flight reconciliation
      if (frameEpoch === 0 && frameSequenceId === 0) {
        return false;
      }
    }

    const current =
      this.serverVersions.get(key) ||
      (seatId ? this.serverVersions.get(venueId) : undefined);

    if (!current) {
      return true;
    }

    if (frameEpoch < current.epoch) {
      return false;
    }

    if (frameEpoch === current.epoch && frameSequenceId <= current.sequenceId) {
      return false;
    }

    return true;
  }

  /**
   * Updates the latest accepted server version if the frame is accepted.
   */
  public acceptUpdate(
    venueId: string,
    seatId: string | undefined,
    frameEpoch: number = 0,
    frameSequenceId: number = 0,
  ): boolean {
    if (
      !this.shouldAcceptUpdate(venueId, seatId, frameEpoch, frameSequenceId)
    ) {
      return false;
    }

    this.recordServerVersion(venueId, seatId, frameEpoch, frameSequenceId);
    return true;
  }

  /**
   * Retrieves the current authoritative server version tag for a venue/seat.
   */
  public getVersion(
    venueId: string,
    seatId?: string,
  ): SeatVersionTag | undefined {
    return this.serverVersions.get(this.getKey(venueId, seatId));
  }
}

export const seatSyncCoordinator = SeatSyncCoordinator.getInstance();
