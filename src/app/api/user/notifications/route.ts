import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retries = 5,
  delay = 50,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const isRetryable =
        error.code === "P2034" || // Prisma transaction conflict/deadlock
        error.message?.includes("40001") || // Serialization failure
        error.message?.includes("40P01") || // Deadlock detected
        error.message?.includes("deadlock") ||
        error.message?.includes("serialization");

      if (attempt >= retries || !isRetryable) {
        throw error;
      }
      const backoff = delay * Math.pow(2, attempt) + Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const notifications = await prisma.pushNotificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const unreadCount = await prisma.pushNotificationLog.count({
      where: { userId, status: { not: "READ" } },
    });

    return NextResponse.json({
      notifications,
      unreadCount,
    });
  } catch (error: any) {
    console.error("GET /api/user/notifications error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    if (body.action === "markAsRead") {
      await executeWithRetry(async () => {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE "PushNotificationLog"
            SET "status" = 'READ', "read" = true
            WHERE "id" IN (
              SELECT "id"
              FROM "PushNotificationLog"
              WHERE "userId" = ${userId} AND "status" != 'READ'
              FOR UPDATE SKIP LOCKED
            )
          `;
        });
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("POST /api/user/notifications error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
