import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import * as Y from "yjs";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      for (const updateBase64 of updates) {
        const binaryString = atob(updateBase64);
        const updateArray = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          updateArray[i] = binaryString.charCodeAt(i);
        }
        Y.applyUpdate(ydoc, updateArray);
      }

      const newState = Buffer.from(Y.encodeStateAsUpdate(ydoc));

      await prisma.user.update({
        where: { id: userId },
        data: { crdtState: newState },
      });
    }

    if (checkIns && Array.isArray(checkIns)) {
      for (const checkIn of checkIns) {
        if (!checkIn.venueId || !checkIn.timestamp) continue;

        await prisma.checkIn.upsert({
          where: {
            userId_venueId: { userId, venueId: checkIn.venueId },
          },
          update: {
            createdAt: new Date(checkIn.timestamp),
            expiresAt: new Date(checkIn.timestamp + 4 * 60 * 60 * 1000),
          },
          create: {
            userId,
            venueId: checkIn.venueId,
            createdAt: new Date(checkIn.timestamp),
            expiresAt: new Date(checkIn.timestamp + 4 * 60 * 60 * 1000),
          },
        });
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
