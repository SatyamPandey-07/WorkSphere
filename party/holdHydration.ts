/**
 * Hydration gate for seat-hold leases (#7954).
 *
 * A PartyKit room that wakes from hibernation starts with empty memory and has
 * to reload its persisted hold leases from room storage. Until that finishes
 * the room cannot know which seats are already held, so any lock request it
 * validated would be checked against an empty map and two clients could both
 * be granted the same seat.
 *
 * The gate closes while a load is in flight, queues the work that arrives in
 * the meantime, and replays it in arrival order once the load settles. A gate
 * that never starts a load is open from the start, so rooms without storage
 * behave exactly as before.
 */

/** Room storage key under which seat-hold leases are persisted. */
export const SEAT_HOLDS_STORAGE_KEY = "seatHolds:v1";

export class HydrationGate {
  private ready = true;
  private queue: Array<() => void> = [];
  private pending: Promise<void> = Promise.resolve();

  /** True when no load is in flight and nothing is waiting. */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Closes the gate, runs `load`, then reopens it and replays queued work.
   * The gate reopens even if `load` throws, so a storage outage degrades to
   * an empty lease table instead of freezing the room forever.
   */
  begin(load: () => Promise<void>): Promise<void> {
    this.ready = false;
    this.pending = (async () => {
      try {
        await load();
      } catch (err) {
        console.error("[HydrationGate] hydration failed, starting empty:", err);
      } finally {
        this.ready = true;
        this.drain();
      }
    })();
    return this.pending;
  }

  /** Resolves once hydration has finished (immediately if none is running). */
  whenReady(): Promise<void> {
    return this.pending;
  }

  /**
   * Runs `task` now when the gate is open, otherwise queues it. Queued tasks
   * run synchronously, in arrival order, the moment hydration completes.
   */
  run(task: () => void): void {
    if (this.ready && this.queue.length === 0) {
      task();
      return;
    }
    this.queue.push(task);
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        task();
      } catch (err) {
        console.error("[HydrationGate] queued task failed:", err);
      }
    }
  }
}
