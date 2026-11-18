import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

export const XP_LEADERBOARD_CACHE_KEY = "cache:leaderboard:xp:top50";
const FRESH_TTL_MS = 60_000;
const STALE_WINDOW_MS = 300_000;
const REVALIDATION_LOCK_KEY = `${XP_LEADERBOARD_CACHE_KEY}:revalidation`;

export interface XpLeaderboardEntry {
  userId: string;
  name: string;
  xp: number;
  tier: string;
  badgeCount: number;
  verifiedCheckIns: number;
}

interface CachedLeaderboard {
  data: XpLeaderboardEntry[];
  freshUntil: number;
  staleUntil: number;
}

async function queryXpLeaderboard(): Promise<XpLeaderboardEntry[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ accurateVotes: "desc" }, { createdAt: "asc" }],
    take: 50,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      accurateVotes: true,
      _count: {
        select: {
          badges: true,
          checkIns: true,
        },
      },
    },
  });

  return users
    .map((user) => {
      const xp = user.accurateVotes;
      const badgeCount = user._count.badges;
      const verifiedCheckIns = user._count.checkIns;
      const tier =
        xp >= 100
          ? "legend"
          : xp >= 50
            ? "expert"
            : xp >= 10
              ? "explorer"
              : "newcomer";

      return {
        userId: user.id,
        name:
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          "Anonymous",
        xp,
        tier,
        badgeCount,
        verifiedCheckIns,
      };
    })
    .sort(
      (a, b) =>
        b.xp - a.xp ||
        b.badgeCount - a.badgeCount ||
        b.verifiedCheckIns - a.verifiedCheckIns,
    );
}

async function recomputeLeaderboard(): Promise<XpLeaderboardEntry[]> {
  const data = await queryXpLeaderboard();
  const redis = getRedis();
  if (redis) {
    const now = Date.now();
    const cached: CachedLeaderboard = {
      data,
      freshUntil: now + FRESH_TTL_MS,
      staleUntil: now + FRESH_TTL_MS + STALE_WINDOW_MS,
    };
    try {
      await redis.set(
        XP_LEADERBOARD_CACHE_KEY,
        JSON.stringify(cached),
        { ex: Math.ceil((FRESH_TTL_MS + STALE_WINDOW_MS) / 1000) },
      );
    } catch (error) {
      console.error("[xpLeaderboard] Redis write failed:", error);
    }
  }
  return data;
}

function parseCachedLeaderboard(value: unknown): CachedLeaderboard | null {
  if (!value) return null;
  try {
    const parsed =
      typeof value === "string" ? JSON.parse(value) : value;
    if (
      !parsed ||
      !Array.isArray(parsed.data) ||
      typeof parsed.freshUntil !== "number" ||
      typeof parsed.staleUntil !== "number"
    ) {
      return null;
    }
    return parsed as CachedLeaderboard;
  } catch {
    return null;
  }
}

async function triggerBackgroundRevalidation(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const lockAcquired = await redis.set(
      REVALIDATION_LOCK_KEY,
      "1",
      { nx: true, ex: 30 },
    );
    if (!lockAcquired) return;

    await recomputeLeaderboard();
  } catch (error) {
    console.error("[xpLeaderboard] Background revalidation failed:", error);
  } finally {
    try {
      await redis.del(REVALIDATION_LOCK_KEY);
    } catch (error) {
      console.error("[xpLeaderboard] Failed to release revalidation lock:", error);
    }
  }
}

export async function getXpLeaderboard(): Promise<{
  data: XpLeaderboardEntry[];
  stale: boolean;
}> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = parseCachedLeaderboard(
        await redis.get(XP_LEADERBOARD_CACHE_KEY),
      );
      if (cached) {
        const now = Date.now();
        if (now < cached.freshUntil) {
          return { data: cached.data, stale: false };
        }
        if (now < cached.staleUntil) {
          void triggerBackgroundRevalidation();
          return { data: cached.data, stale: true };
        }
      }
    } catch (error) {
      console.error("[xpLeaderboard] Redis read failed:", error);
    }
  }

  return { data: await recomputeLeaderboard(), stale: false };
}

export async function invalidateXpLeaderboard(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(XP_LEADERBOARD_CACHE_KEY);
  } catch (error) {
    console.error("[xpLeaderboard] Redis invalidation failed:", error);
  }
}
