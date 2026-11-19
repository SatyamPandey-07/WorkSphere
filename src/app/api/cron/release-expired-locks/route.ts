import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!cronSecret && !isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    let releasedSeatIds: string[] = [];

    // Safe execution if SeatLock exists in DB
    try {
      const expiredLocks: any[] = await (prisma as any).$queryRawUnsafe(
        `SELECT "seatId" FROM "SeatLock" WHERE "expiresAt" < $1 AND "status" = 'PENDING' FOR UPDATE`,
        now,
      );

      if (expiredLocks && expiredLocks.length > 0) {
        await (prisma as any).$executeRawUnsafe(
          `UPDATE "SeatLock" SET "status" = 'EXPIRED', "updatedAt" = $1 WHERE "expiresAt" < $1 AND "status" = 'PENDING'`,
          now,
        );
        releasedSeatIds = expiredLocks.map((l: any) => l.seatId);
      }
    } catch {
      // Table SeatLock does not exist in relational schema; lock expiration handled via Redis keyspace notifications
    }

    if (releasedSeatIds.length > 0) {
      const partykitHost =
        process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
      try {
        await fetch(`https://${partykitHost}/party/seat-inventory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "SEATS_RELEASED",
            seatIds: releasedSeatIds,
          }),
        });
      } catch (err) {
        console.error("Failed to broadcast PartyKit seat release event:", err);
      }
    }

    return NextResponse.json({
      success: true,
      releasedCount: releasedSeatIds.length,
      releasedSeats: releasedSeatIds,
    });
  } catch (error) {
    console.error("Error releasing expired seat locks:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
