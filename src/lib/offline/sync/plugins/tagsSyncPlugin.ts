import type { ISyncPlugin, SyncItem, SyncResult, FavoriteTagBulkUpdate } from "../../types";

export function sortTagIdsDeterministically(ids: string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export class TagsSyncPlugin implements ISyncPlugin<FavoriteTagBulkUpdate> {
  public readonly domain = "tags";

  async sync(items: SyncItem<FavoriteTagBulkUpdate>[]): Promise<SyncResult> {
    if (items.length === 0) {
      return { success: true, syncedIds: [] };
    }

    const updates = items.map((i) => i.payload);
    const orderedIds = sortTagIdsDeterministically(updates.map((u) => u.id));

    try {
      const res = await fetch("/api/favorite-tags/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates, orderedIds }),
      });

      if (res.ok) {
        return {
          success: true,
          syncedIds: items.map((i) => i.id),
        };
      }

      return {
        success: false,
        syncedIds: [],
        failedIds: items.map((i) => i.id),
      };
    } catch {
      return {
        success: false,
        syncedIds: [],
        failedIds: items.map((i) => i.id),
      };
    }
  }
}

export const tagsSyncPlugin = new TagsSyncPlugin();
