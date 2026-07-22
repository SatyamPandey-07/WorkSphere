import { prisma } from "@/lib/prisma";

export type FavoriteTagBulkUpdate = {
  id: string;
  name?: string;
  color?: string;
};

/**
 * Sort tag IDs so every concurrent bulk sync locks FavoriteTag rows in the
 * same order. Unordered locking across overlapping sets is what produces
 * PostgreSQL deadlocks (Prisma P2034) when syncing 50+ venue tags at once.
 */
export function sortTagIdsDeterministically(ids: string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Apply bulk FavoriteTag field updates inside a single Prisma transaction.
 * Writes always run in deterministic tag-id order to avoid row-lock deadlocks.
 */
export async function syncFavoriteTagsBulk(updates: FavoriteTagBulkUpdate[]) {
  if (updates.length === 0) {
    return [];
  }

  // Last write wins if the same id appears twice in the payload.
  const byId = new Map<string, FavoriteTagBulkUpdate>();
  for (const update of updates) {
    byId.set(update.id, update);
  }

  const orderedIds = sortTagIdsDeterministically([...byId.keys()]);

  return prisma.$transaction(
    orderedIds.map((id) => {
      const update = byId.get(id)!;
      const data: { name?: string; color?: string } = {};
      if (update.name !== undefined) data.name = update.name;
      if (update.color !== undefined) data.color = update.color;

      return prisma.favoriteTag.update({
        where: { id },
        data,
      });
    }),
  );
}
