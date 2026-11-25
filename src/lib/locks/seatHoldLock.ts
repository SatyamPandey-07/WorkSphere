/**
 * @fileoverview Concurrency-Safe Seat Hold Lock backed by an $O(1)$ Hashed Timing-Wheel Scheduler.
 *
 * ## Timing-Wheel Expiration Architecture
 *
 * 1. **Circular Bucket Ring & Power-of-Two Bitmasking:**
 *    Uses $N = 2^k$ slots (`wheelSize`, default `512`) advancing by `tickMs` (default `100ms`).
 *    Bucket indices map in $O(1)$ via bitwise AND (`totalTicks & (wheelSize - 1)`).
 *
 * 2. **Round Counters (`remainingRounds`) for Multi-Revolution Leases:**
 *    Maps any TTL $\Delta t$ to `ticksAhead = max(1, ceil(ttlMs / tickMs))` with
 *    `remainingRounds = floor((ticksAhead - 1) / wheelSize)`, firing in FIFO order at round 0.
 *
 * 3. **Amortized $O(1)$ Lifecycle & Fencing Tokens:**
 *    `acquireHold`, `renewHold`, and `releaseHold` execute in $O(1)$ time with monotonic
 *    per-seat fencing `version` tokens so stale wheel ticks never evict newer lease holders.
 */
import { HashedTimingWheel, type FiredTimingTask } from '@/lib/venues/hashedTimingWheel';
export interface SeatHoldRecord { seatId: string; holderId: string; version: number; acquiredAtMs: number; expiresAtMs: number; }
export interface SeatHoldAcquireResult { acquired: boolean; hold: SeatHoldRecord; reason?: string; }
export interface SeatHoldLockOptions { tickMs?: number; wheelSize?: number; initialTimeMs?: number; onHoldExpired?: (expiredHold: SeatHoldRecord) => void; }
interface WheelHoldPayload { seatId: string; holderId: string; version: number; }
/** Manages mutually exclusive seat holds with $O(1)$ timing-wheel lease expirations and fencing tokens. */
export class SeatHoldLockManager { private readonly wheel: HashedTimingWheel<WheelHoldPayload>; private readonly activeHolds = new Map<string, SeatHoldRecord>(); private readonly versionBySeat = new Map<string, number>(); private readonly onHoldExpired?: (expiredHold: SeatHoldRecord) => void; constructor(options: SeatHoldLockOptions = {}) { this.onHoldExpired = options.onHoldExpired; this.wheel = new HashedTimingWheel<WheelHoldPayload>({ tickMs: options.tickMs ?? 100, wheelSize: options.wheelSize ?? 512, initialTimeMs: options.initialTimeMs ?? 0, onExpire: (task) => this.handleWheelExpiration(task) }); } private handleWheelExpiration(task: FiredTimingTask<WheelHoldPayload>): void { const current = this.activeHolds.get(task.payload.seatId); if (!current || current.version !== task.payload.version) return; this.activeHolds.delete(task.payload.seatId); this.onHoldExpired?.({ ...current }); } /** Acquires or renews an exclusive lease on `seatId` in $O(1)$ amortized time. */ public acquireHold(seatId: string, holderId: string, ttlMs: number): SeatHoldAcquireResult { const nowMs = this.wheel.getCurrentTimeMs(); const safeTtlMs = typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : 0; const existing = this.activeHolds.get(seatId); if (existing && existing.expiresAtMs > nowMs) { if (existing.holderId !== holderId) return { acquired: false, hold: { ...existing }, reason: `Seat "${seatId}" is currently held by "${existing.holderId}" ` }; const renewed: SeatHoldRecord = { ...existing, expiresAtMs: nowMs + safeTtlMs }; this.activeHolds.set(seatId, renewed); this.wheel.reschedule(seatId, safeTtlMs, { seatId, holderId, version: renewed.version }); return { acquired: true, hold: { ...renewed } }; } const nextVersion = (this.versionBySeat.get(seatId) ?? 0) + 1; this.versionBySeat.set(seatId, nextVersion); const record: SeatHoldRecord = { seatId, holderId, version: nextVersion, acquiredAtMs: nowMs, expiresAtMs: nowMs + safeTtlMs }; this.activeHolds.set(seatId, record); this.wheel.schedule(seatId, safeTtlMs, { seatId, holderId, version: nextVersion }); return { acquired: true, hold: { ...record } }; } /** Releases `seatId` if owned by `holderId` and cancels its timing-wheel timer in $O(1)$. */ public releaseHold(seatId: string, holderId: string): boolean { const existing = this.activeHolds.get(seatId); if (!existing || existing.holderId !== holderId) return false; this.activeHolds.delete(seatId); this.wheel.cancel(seatId); return true; } /** Returns the active lease record for `seatId`, or `undefined` if unlocked. */ public getHold(seatId: string): SeatHoldRecord | undefined { const existing = this.activeHolds.get(seatId); return existing ? { ...existing } : undefined; } /** Advances the timing wheel by `elapsedMs` and returns evicted lease records. */ public advanceTimeBy(elapsedMs: number): SeatHoldRecord[] { const expired: SeatHoldRecord[] = []; for (const task of this.wheel.advanceBy(elapsedMs)) expired.push({ seatId: task.payload.seatId, holderId: task.payload.holderId, version: task.payload.version, acquiredAtMs: task.scheduledAtMs, expiresAtMs: task.deadlineMs }); return expired; } /** Returns the number of currently active seat holds. */ public getActiveHoldCount(): number { return this.activeHolds.size; } }
export default SeatHoldLockManager;
