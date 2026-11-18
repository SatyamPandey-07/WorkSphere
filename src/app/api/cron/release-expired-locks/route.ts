import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { seatLocks } from "@/lib/db/schema";
import { lt, eq } from "drizzle-orm";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();

    const expiredLocks = await db.transaction(async (tx) => {
      const locks = await tx
        .select()
        .from(seatLocks)
        .where(lt(seatLocks.expiresAt, now))
        .where(eq(seatLocks.status, "PENDING"));

      if (locks.length === 0) return [];

      const seatIds = locks.map((l) => l.seatId);

      await tx
        .update(seatLocks)
        .set({ status: "EXPIRED", updatedAt: now })
        .where(lt(seatLocks.expiresAt, now))
        .where(eq(seatLocks.status, "PENDING"));

      return seatIds;
    });

    if (expiredLocks.length > 0) {
      const partykitHost = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
      try {
        await fetch(`https://${partykitHost}/party/seat-inventory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "SEATS_RELEASED", seatIds: expiredLocks }),
        });
      } catch (err) {
        console.error("Failed to broadcast PartyKit seat release event:", err);
      }
    }

    return NextResponse.json({
      success: true,
      releasedCount: expiredLocks.length,
      releasedSeats: expiredLocks,
    });
  } catch (error) {
    console.error("Error releasing expired seat locks:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}