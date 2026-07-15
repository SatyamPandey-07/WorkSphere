import { getRedis } from "@/lib/redis";
import {
  extractAndStoreMemories,
  updateUserPreferencesSummary,
} from "@/lib/agents/MemoryAgent";

/**
 * Prevent expensive background syncs from running on every
 * incoming chat message.
 *
 * At most one sync is allowed every 5 minutes per conversation.
 */
export async function triggerBackgroundMemorySync(
  conversationId: string,
  userId: string,
) {
  const redis = getRedis();

  // If Redis isn't configured, preserve existing behaviour.
  if (!redis) {
    extractAndStoreMemories(conversationId)
      .then(() => updateUserPreferencesSummary(userId))
      .catch((err) =>
        console.error("[BackgroundSync] Memory sync failed:", err),
      );

    return;
  }

  const key = `background-memory-sync:${conversationId}`;

  try {
    // Only one request should acquire the lock.
    const acquired = await redis.set(key, "1", {
      nx: true,
      ex: 300,
    });

    if (!acquired) {
      return;
    }

    extractAndStoreMemories(conversationId)
      .then(() => updateUserPreferencesSummary(userId))
      .catch((err) =>
        console.error("[BackgroundSync] Memory sync failed:", err),
      );
  } catch (err) {
    console.error("[BackgroundSync] Redis error:", err);

    // If Redis fails, don't lose functionality.
    extractAndStoreMemories(conversationId)
      .then(() => updateUserPreferencesSummary(userId))
      .catch((err) =>
        console.error("[BackgroundSync] Memory sync failed:", err),
      );
  }
}
