import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure Identity
    await ensureUserExists(userId);

    const url = req?.url
      ? new URL(req.url)
      : new URL("http://localhost/api/bookings/history");
    const searchParams = url.searchParams;

    // 1. Pagination parameters: take and cursor
    const takeParam = searchParams.get("take") || searchParams.get("limit");
    const take = takeParam
      ? Math.min(100, Math.max(1, parseInt(takeParam, 10) || 20))
      : 20;

    const cursor = searchParams.get("cursor");

    // 2. Sorting by date (asc or desc, defaults to desc)
    const sortParam =
      searchParams.get("sort") ||
      searchParams.get("order") ||
      searchParams.get("dateSort");
    const sortDirection: "asc" | "desc" =
      sortParam?.toLowerCase() === "asc" ? "asc" : "desc";

    // 3. Status filter (CONFIRMED, CANCELLED, COMPLETED, etc.)
    const statusParam = searchParams.get("status");
    const where: any = { userId };

    if (statusParam) {
      const statuses = statusParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const todayStr = new Date().toISOString().split("T")[0];

      if (statuses.length === 1) {
        const s = statuses[0];
        if (s === "COMPLETED") {
          where.OR = [
            { status: "COMPLETED" },
            { status: "CONFIRMED", date: { lt: todayStr } },
          ];
        } else if (s === "CONFIRMED") {
          where.status = "CONFIRMED";
        } else if (s === "CANCELLED") {
          where.status = "CANCELLED";
        } else {
          where.status = s;
        }
      } else if (statuses.length > 1) {
        const orConditions: any[] = [];
        for (const s of statuses) {
          if (s === "COMPLETED") {
            orConditions.push({ status: "COMPLETED" });
            orConditions.push({ status: "CONFIRMED", date: { lt: todayStr } });
          } else {
            orConditions.push({ status: s });
          }
        }
        where.OR = orConditions;
      }
    }

    // Execute cursor-based query (fetching take + 1 to detect hasMore)
    const items = await (prisma as any).booking.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        venue: {
          select: {
            name: true,
            category: true,
            address: true,
          },
        },
      },
      orderBy: [
        { date: sortDirection },
        { time: sortDirection },
        { id: sortDirection },
      ],
    });

    const hasMore = items.length > take;
    const bookings = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore
      ? (bookings[bookings.length - 1]?.id ?? null)
      : null;

    return NextResponse.json({
      bookings,
      nextCursor,
      hasMore,
      total: bookings.length,
    });
  } catch (error: any) {
    console.error("[Bookings History Error]:", error);

    // If invalid cursor record not found, return empty set gracefully
    if (error?.code === "P2025") {
      return NextResponse.json({
        bookings: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
      });
    }

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
