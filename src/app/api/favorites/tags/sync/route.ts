import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { updateUserPreferencesSummary } from "@/lib/agents/MemoryAgent";

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
    const operations: SyncOperation[] = body.operations || [];

    if (!operations || !Array.isArray(operations)) {
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
  } catch (error) {
    console.error("POST /api/favorites/tags/sync error:", error);
    return NextResponse.json(
      { error: "Failed to sync favorites" },
      { status: 500 },
    );
  }
}
