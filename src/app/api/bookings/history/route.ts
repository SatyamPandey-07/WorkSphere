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

    // 1. Pagination parameters: page, limit, take, cursor
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit") || searchParams.get("take");
    const limit = limitParam
      ? Math.min(50, Math.max(1, parseInt(limitParam, 10) || 10))
      : 10;

    const cursor = searchParams.get("cursor");
    const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : undefined;

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

    // 4. Date range filter (startDate and endDate)
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    if (startDate || endDate) {
      const dateFilter: { gte?: string; lte?: string } = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lte = endDate;
      where.date = dateFilter;
    }

    // Prepare findMany query arguments
    const queryArgs: any = {
      where,
      take: limit + 1,
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            category: true,
            address: true,
            latitude: true,
            longitude: true,
          },
        },
      },
      orderBy: [
        { date: sortDirection },
        { time: sortDirection },
        { id: sortDirection },
      ],
    };

    if (cursor) {
      queryArgs.cursor = { id: cursor };
      queryArgs.skip = 1;
    } else if (page !== undefined) {
      queryArgs.skip = (page - 1) * limit;
    }

    // Execute query (fetching limit + 1 to detect hasMore / hasNextPage)
    const items = await (prisma as any).booking.findMany(queryArgs);

    const hasMore = items.length > limit;
    const bookings = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore
      ? (bookings[bookings.length - 1]?.id ?? null)
      : null;

    // Total count calculation for pagination metadata
    let totalCount = 0;
    if (typeof (prisma as any).booking?.count === "function") {
      totalCount = await (prisma as any).booking.count({ where });
    } else {
      totalCount = hasMore
        ? (page !== undefined ? (page - 1) * limit + items.length : items.length)
        : bookings.length;
    }

    const totalPages = limit > 0 ? Math.ceil(totalCount / limit) : 0;
    const currentPage = page ?? 1;
    const hasNextPage = page !== undefined ? currentPage < totalPages : hasMore;

    return NextResponse.json({
      bookings,
      nextCursor,
      hasMore,
      total: bookings.length,
      page: currentPage,
      limit,
      totalCount,
      totalPages,
      hasNextPage,
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
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 0,
        hasNextPage: false,
      });
    }

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
