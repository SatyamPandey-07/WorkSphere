import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { updateUserPreferencesSummary } from "@/lib/agents/MemoryAgent";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import {
  bulkFavoriteSyncSchema,
  syncFavoriteTagsSchema,
  validateRequest,
  type SyncFavoriteOperation,
} from "@/lib/validations";
import { syncFavoriteTagsBulk } from "@/lib/favoriteTagSync";

const FAVORITES_SYNC_RATE_LIMIT = 30;
const FAVORITES_SYNC_WINDOW_MS = 60_000;

class UnresolvedVenuesError extends Error {
  constructor(public readonly missingVenueIds: string[]) {
    super("One or more venues were not found");
    this.name = "UnresolvedVenuesError";
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await ensureUserExists(userId);
    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimitKey = `favorites-sync:${userId}`;
    const allowed = await rateLimit(
      rateLimitKey,
      FAVORITES_SYNC_RATE_LIMIT,
      FAVORITES_SYNC_WINDOW_MS,
    );
    if (!allowed) {
      const info = await getRateLimitInfo(
        rateLimitKey,
        FAVORITES_SYNC_RATE_LIMIT,
        FAVORITES_SYNC_WINDOW_MS,
      );
      const retryAfter = info?.resetTime
        ? Math.max(1, Math.ceil((info.resetTime - Date.now()) / 1000))
        : 60;
      return NextResponse.json(
        {
          error: "Too many sync requests. Please try again later.",
          retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body" },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    // 1. Check if this is a Bulk Favorites Sync request
    if ("operations" in body) {
      const validation = validateRequest(bulkFavoriteSyncSchema, body);
      if (!validation.success) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const operations: SyncFavoriteOperation[] = validation.data.operations;

      // Sort non-destructively by timestamp ascending (preserving original order on ties)
      const indexedOps = operations.map((op, index) => ({ op, index }));
      indexedOps.sort(
        (a, b) => a.op.timestamp - b.op.timestamp || a.index - b.index,
      );

      // Keep only the latest action per venueId
      const finalActions = new Map<string, "add" | "remove">();
      for (const { op } of indexedOps) {
        finalActions.set(op.venueId, op.action);
      }

      const requestedVenueIds = Array.from(finalActions.keys());

      const processedCount = await prisma.$transaction(async (tx) => {
        const venues = await tx.venue.findMany({
          where: {
            OR: [
              { id: { in: requestedVenueIds } },
              { placeId: { in: requestedVenueIds } },
            ],
          },
          select: { id: true, placeId: true },
        });

        const venueIdLookup = new Map<string, string>();
        for (const v of venues) {
          venueIdLookup.set(v.id, v.id);
          if (v.placeId) {
            venueIdLookup.set(v.placeId, v.id);
          }
        }

        const missingAddIds: string[] = [];
        const resolvedActions = new Map<string, "add" | "remove">();
        let unmappedRemoveCount = 0;

        for (const { op } of indexedOps) {
          const resolvedId = venueIdLookup.get(op.venueId);
          if (!resolvedId) {
            if (finalActions.get(op.venueId) === "add") {
              if (!missingAddIds.includes(op.venueId)) {
                missingAddIds.push(op.venueId);
              }
            }
          } else {
            // Re-fold in timestamp order by canonical DB venue.id so matching id/placeId stay consistent
            resolvedActions.set(resolvedId, op.action);
          }
        }

        if (missingAddIds.length > 0) {
          throw new UnresolvedVenuesError(missingAddIds);
        }

        for (const [rawId, action] of finalActions.entries()) {
          if (action === "remove" && !venueIdLookup.has(rawId)) {
            unmappedRemoveCount++;
          }
        }

        const addVenueIds: string[] = [];
        const removeVenueIds: string[] = [];

        for (const [resolvedId, action] of resolvedActions.entries()) {
          if (action === "add") {
            addVenueIds.push(resolvedId);
          } else {
            removeVenueIds.push(resolvedId);
          }
        }

        addVenueIds.sort();
        removeVenueIds.sort();

        if (addVenueIds.length > 0) {
          await tx.favorite.createMany({
            data: addVenueIds.map((venueId) => ({ userId, venueId })),
            skipDuplicates: true,
          });
        }

        if (removeVenueIds.length > 0) {
          await tx.favorite.deleteMany({
            where: {
              userId,
              venueId: { in: removeVenueIds },
            },
          });
        }

        return addVenueIds.length + removeVenueIds.length + unmappedRemoveCount;
      });

      if (processedCount > 0) {
        updateUserPreferencesSummary(userId).catch((err) =>
          console.error(
            "[FavoriteAPI Bulk Sync] Background preference sync failed:",
            err,
          ),
        );
      }

      return NextResponse.json({ success: true, processed: processedCount });
    }

    // 2. Otherwise, treat as Favorite Tags Sync request
    const validation = validateRequest(syncFavoriteTagsSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { updates } = validation.data;
    const tagIds = updates.map((u) => u.id);

    const ownedTags = await prisma.favoriteTag.findMany({
      where: {
        id: { in: tagIds },
        favorite: { userId },
      },
      select: { id: true },
    });

    if (ownedTags.length !== new Set(tagIds).size) {
      return NextResponse.json(
        { error: "One or more tags were not found" },
        { status: 404 },
      );
    }

    const tags = await syncFavoriteTagsBulk(updates);

    return NextResponse.json({ tags });
  } catch (error: unknown) {
    if (error instanceof UnresolvedVenuesError) {
      return NextResponse.json(
        {
          error: "One or more venues were not found",
          unknownVenueIds: error.missingVenueIds,
        },
        { status: 404 },
      );
    }

    console.error("POST /api/favorites/tags/sync error:", error);

    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;

    if (code === "P2002") {
      return NextResponse.json(
        { error: "Tag with this name already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to sync favorites or tags" },
      { status: 500 },
    );
  }
}
