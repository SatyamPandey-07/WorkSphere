/**
 * SyncQueue.ts
 * Manages the sequential execution and retry logic for offline network requests.
 * Listens for online events and processes the IndexedDB draft queue.
 */

import { DraftStore, BookingDraft } from "./DraftStore";
import { ConflictResolver, ServerState } from "./ConflictResolver";
import { calculateBackoff } from "../../lib/offlineSyncQueue";

export interface DraftRetryMetadata {
  draftId: string;
  attempts: number;
  nextAttemptAtMs: number;
  status: "pending" | "retry" | "conflict" | "dead_letter";
  lastError?: string;
}

export class SyncQueue {
  private draftStore: DraftStore;
  private conflictResolver: ConflictResolver;
  private isSyncing: boolean = false;
  private readonly retryState = new Map<string, DraftRetryMetadata>();
  private readonly maxRetries: number;

  constructor(localNodeId: string = "booking-sync-worker", maxRetries: number = 5) {
    this.draftStore = new DraftStore();
    this.conflictResolver = new ConflictResolver(localNodeId);
    this.maxRetries = maxRetries;
    this.setupNetworkListeners();
  }

  public getRetryMetadata(draftId: string): DraftRetryMetadata | undefined {
    return this.retryState.get(draftId);
  }

  public getDeadLetterDrafts(): DraftRetryMetadata[] {
    return Array.from(this.retryState.values()).filter(
      (meta) => meta.status === "dead_letter",
    );
  }

  private setupNetworkListeners(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.processQueue());
    }
  }

  public getConflictResolver(): ConflictResolver {
    return this.conflictResolver;
  }

  public getDraftStore(): DraftStore {
    return this.draftStore;
  }

  public async queueDraft(draft: BookingDraft): Promise<void> {
    await this.draftStore.init();
    await this.draftStore.saveDraft(draft);

    if (typeof navigator !== "undefined" && navigator.onLine) {
      this.processQueue().catch(console.error);
    }
  }

  public async processQueue(): Promise<void> {
    if (
      this.isSyncing ||
      (typeof navigator !== "undefined" && !navigator.onLine)
    )
      return;
    this.isSyncing = true;

    try {
      await this.draftStore.init();
      const drafts = await this.draftStore.getAllDrafts();

      const nowMs = Date.now();
      for (const draft of drafts) {
        const existingMeta = this.retryState.get(draft.id);
        if (existingMeta) {
          if (existingMeta.status === "dead_letter") continue;
          if (existingMeta.nextAttemptAtMs > nowMs) continue;
        }

        const success = await this.syncSingleDraft(draft);
        if (success) {
          this.retryState.delete(draft.id);
          await this.draftStore.deleteDraft(draft.id);
        } else {
          const current = this.retryState.get(draft.id);
          if (current?.status === "conflict") continue;
          const nextAttempts = (current?.attempts ?? 0) + 1;
          if (nextAttempts >= this.maxRetries) {
            this.retryState.set(draft.id, {
              draftId: draft.id,
              attempts: nextAttempts,
              nextAttemptAtMs: Number.POSITIVE_INFINITY,
              status: "dead_letter",
              lastError: current?.lastError ?? "Max sync retries exceeded",
            });
          } else {
            const delayMs = calculateBackoff(nextAttempts - 1);
            this.retryState.set(draft.id, {
              draftId: draft.id,
              attempts: nextAttempts,
              nextAttemptAtMs: Date.now() + delayMs,
              status: "retry",
              lastError: current?.lastError,
            });
          }
        }
      }
    } catch (error) {
      console.error("Error processing sync queue:", error);
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncSingleDraft(draft: BookingDraft): Promise<boolean> {
    try {
      // If the draft was created as an offline reservation draft (starts with 'draft-')
      if (draft.id.startsWith("draft-")) {
        const created = await this.createBooking(draft);
        if (created && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("worksphere:booking-draft-synced", {
              detail: { draftId: draft.id, venueId: draft.venueId },
            }),
          );
        }
        return created;
      }

      // 1. Fetch current server state
      const serverResponse = await fetch(`/api/bookings/${draft.id}`);
      if (!serverResponse.ok) {
        // If it's a 404, the booking doesn't exist on server, so we can create it
        if (serverResponse.status === 404) {
          const created = await this.createBooking(draft);
          if (created && typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("worksphere:booking-draft-synced", {
                detail: { draftId: draft.id, venueId: draft.venueId },
              }),
            );
          }
          return created;
        }
        throw new Error(
          `Failed to fetch server state: ${serverResponse.status}`,
        );
      }

      const serverState: ServerState = await serverResponse.json();

      // 2. Resolve conflicts using Vector Clock CRDT
      const mergeResult = this.conflictResolver.resolve(draft, serverState);

      if (mergeResult.requiresUserInput) {
        this.retryState.set(draft.id, {
          draftId: draft.id,
          attempts: this.retryState.get(draft.id)?.attempts ?? 0,
          nextAttemptAtMs: Number.POSITIVE_INFINITY,
          status: "conflict",
          lastError: "Requires user conflict resolution",
        });
        // Dispatch custom event to notify UI
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("booking_sync_conflict", { detail: mergeResult }),
          );
        }
        return false; // Do not delete draft, wait for user resolution
      }

      // 3. Apply merged state to server with updated Vector Clock
      const updateResponse = await fetch(`/api/bookings/${draft.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `booking-sync-${draft.id}-v${(serverState.version || 0) + 1}`,
        },
        body: JSON.stringify({
          payload: mergeResult.resolvedPayload,
          version: (serverState.version || 0) + 1,
          vectorClock: mergeResult.resolvedVectorClock,
          causalOrder: mergeResult.causalOrder,
        }),
      });

      return updateResponse.ok;
    } catch (error) {
      console.error(`Failed to sync draft ${draft.id}:`, error);
      return false;
    }
  }

  private async createBooking(draft: BookingDraft): Promise<boolean> {
    try {
      const isConfirmPayload = Boolean(
        draft.payload &&
        typeof draft.payload === "object" &&
        "venue" in draft.payload &&
        "dates" in draft.payload,
      );

      const endpoint = isConfirmPayload
        ? "/api/bookings/confirm"
        : "/api/bookings";
      const bodyPayload = isConfirmPayload
        ? {
            ...draft.payload,
            vectorClock: draft.vectorClock,
            draftId: draft.id,
          }
        : {
            ...draft.payload,
            venueId: draft.venueId,
            userId: draft.userId,
            vectorClock: draft.vectorClock,
          };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `booking-sync-${draft.id}-v${(serverState.version || 0) + 1}`,
        },
        body: JSON.stringify(bodyPayload),
      });
      return response.ok;
    } catch (error) {
      console.error(`Failed to create booking from draft ${draft.id}:`, error);
      return false;
    }
  }
}

export const globalSyncQueue = new SyncQueue();
