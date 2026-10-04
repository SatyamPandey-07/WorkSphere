import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import * as Y from "yjs";
import { ensureUserExists } from "@/lib/auth";
import { recordCheckIn, CHECK_IN_TTL_MS } from "@/lib/checkIn";

// Bounds for CRDT update ingestion: decoding and merging are billed to the
// request, so oversized batches are rejected before any work happens.
const MAX_SYNC_UPDATES = 100;
const MAX_SYNC_UPDATE_BYTES = 1024 * 1024;
const MAX_SYNC_TOTAL_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    const { updates, checkIns } = await req.json();

    if (updates && !Array.isArray(updates)) {
      return NextResponse.json(
        { error: "Invalid updates format" },
        { status: 400 },
      );
    }

    if (checkIns && !Array.isArray(checkIns)) {
      return NextResponse.json(
        { error: "Invalid checkIns format" },
        { status: 400 },
      );
    }

    // Get current user CRDT state
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { crdtState: true },
    });

    const ydoc = new Y.Doc();
    if (user?.crdtState) {
      Y.applyUpdate(ydoc, new Uint8Array(user.crdtState));
    }

    if (updates && Array.isArray(updates)) {
      if (updates.length > MAX_SYNC_UPDATES) {
        return NextResponse.json(
          { error: "Too many updates in a single sync request" },
          { status: 400 },
        );
      }

      let totalBytes = 0;
      const decodedUpdates: Uint8Array[] = [];
      for (const updateBase64 of updates) {
        if (typeof updateBase64 !== "string" || updateBase64.length === 0) {
          return NextResponse.json(
            { error: "Invalid updates format" },
            { status: 400 },
          );
        }
        // atob length approximates decoded size (4 chars -> 3 bytes).
        const approxBytes = Math.floor((updateBase64.length * 3) / 4);
        if (approxBytes > MAX_SYNC_UPDATE_BYTES) {
          return NextResponse.json(
            { error: "Sync update exceeds maximum size" },
            { status: 400 },
          );
        }
        totalBytes += approxBytes;
        if (totalBytes > MAX_SYNC_TOTAL_BYTES) {
          return NextResponse.json(
            { error: "Sync payload exceeds maximum size" },
            { status: 400 },
          );
        }
        let binaryString: string;
        try {
          binaryString = atob(updateBase64);
        } catch {
          return NextResponse.json(
            { error: "Invalid updates format" },
            { status: 400 },
          );
        }
        const updateArray = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          updateArray[i] = binaryString.charCodeAt(i);
        }
        decodedUpdates.push(updateArray);
      }

      for (const updateArray of decodedUpdates) {
        try {
          Y.applyUpdate(ydoc, updateArray);
        } catch {
          return NextResponse.json(
            { error: "Invalid updates format" },
            { status: 400 },
          );
        }
      }

      const newState = Buffer.from(Y.encodeStateAsUpdate(ydoc));

      await prisma.user.update({
        where: { id: userId },
        data: { crdtState: newState },
      });
    }

    if (checkIns && Array.isArray(checkIns)) {
      // Offline check-ins are replayed as a live check-in at sync time; stale
      // ones (older than the check-in TTL) are dropped rather than faked.
      const cutoff = Date.now() - CHECK_IN_TTL_MS;
      for (const checkIn of checkIns.slice(0, 50)) {
        if (typeof checkIn?.venueId !== "string" || !checkIn.timestamp)
          continue;
        const stamp = new Date(checkIn.timestamp).getTime();
        if (!Number.isFinite(stamp) || stamp < cutoff) continue;

        const venue = await prisma.venue.findFirst({
          where: {
            OR: [{ id: checkIn.venueId }, { placeId: checkIn.venueId }],
          },
          select: { id: true, name: true, latitude: true, longitude: true },
        });
        if (venue) await recordCheckIn(userId, venue);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Sync API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
