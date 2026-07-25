import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { updateUserPreferencesSummary } from "@/lib/agents/MemoryAgent";
import { syncFavoriteTagsSchema, validateRequest } from "@/lib/validations";
import { syncFavoriteTagsBulk } from "@/lib/favoriteTagSync";

interface SyncOperation {
  venueId: string;
  action: "add" | "remove";
  timestamp: number;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const body = await req.json();

    // 1. Check if this is a Favorites Sync request
    if (body.operations) {
      const operations: SyncOperation[] = body.operations;
      if (!Array.isArray(operations)) {
        return NextResponse.json(
          { error: "Invalid operations array" },
          { status: 400 },
        );
      }

      // Sort operations by timestamp so they are processed in order
      operations.sort((a, b) => a.timestamp - b.timestamp);

      // Keep track of the final action for each venueId to avoid redundant db operations
      const finalActions = new Map<string, "add" | "remove">();
      for (const op of operations) {
        finalActions.set(op.venueId, op.action);
      }

      let processedCount = 0;

      for (const [venueId, action] of finalActions.entries()) {
        // Find venue in DB
        let venue = await prisma.venue.findFirst({
          where: {
            OR: [{ id: venueId }, { placeId: venueId }],
          },
        });

        if (action === "add") {
          if (!venue) {
            // Upsert venue if missing
            venue = await prisma.venue.create({
              data: {
                placeId: venueId,
                name: "Unknown Venue",
                latitude: 0,
                longitude: 0,
                category: "other",
              },
            });
          }

          await prisma.favorite.upsert({
            where: {
              userId_venueId: {
                userId,
                venueId: venue.id,
              },
            },
            update: {},
            create: {
              userId,
              venueId: venue.id,
            },
          });
          processedCount++;
        } else if (action === "remove") {
          if (venue) {
            try {
              await prisma.favorite.delete({
                where: {
                  userId_venueId: {
                    userId,
                    venueId: venue.id,
                  },
                },
              });
            } catch (e: any) {
              if (e.code !== "P2025") throw e; // ignore already deleted
            }
          }
          processedCount++;
        }
      }

      if (processedCount > 0) {
        // Trigger background sync just like the regular POST/DELETE
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
