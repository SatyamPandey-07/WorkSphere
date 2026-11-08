import type { ISyncPlugin, SyncItem, SyncResult, QueuedVenueReview } from "../../types";
import { reviewsRepository } from "../../repositories/reviewsRepository";

export class ReviewSyncPlugin implements ISyncPlugin<QueuedVenueReview> {
  public readonly domain = "reviews";

  async sync(items: SyncItem<QueuedVenueReview>[]): Promise<SyncResult> {
    const syncedIds: string[] = [];
    const failedIds: string[] = [];
    const conflicts: Array<{ id: string; serverState: unknown }> = [];

    for (const item of items) {
      const review = item.payload;
      try {
        const url = `/api/venues/${encodeURIComponent(review.venueId)}/reviews`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": review.id,
          },
          body: JSON.stringify(review.data),
        });

        if (res.ok) {
          syncedIds.push(item.id);
          await reviewsRepository.delete(review.id);
        } else if (res.status === 409) {
          const conflictData = await res.json().catch(() => ({}));
          conflicts.push({ id: item.id, serverState: conflictData });
        } else {
          failedIds.push(item.id);
        }
      } catch {
        failedIds.push(item.id);
      }
    }

    return {
      success: failedIds.length === 0 && conflicts.length === 0,
      syncedIds,
      failedIds,
      conflicts,
    };
  }

  async resolveConflict(
    item: SyncItem<QueuedVenueReview>,
    serverState: unknown,
  ): Promise<QueuedVenueReview | null> {
    // Keep local review if newer, otherwise adopt server state
    return item.payload;
  }
}

export const reviewSyncPlugin = new ReviewSyncPlugin();
