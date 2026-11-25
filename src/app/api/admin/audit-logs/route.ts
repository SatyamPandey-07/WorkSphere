import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/**
 * Safely parses and clamps the `limit` query parameter.
 * - Missing, empty, non-numeric, or zero -> 20 (safe default)
 * - Negative (e.g. -10) -> 1
 * - Values between 1 and 100 -> as-is (e.g. 1 -> 1, 50 -> 50, 100 -> 100)
 * - Values > 100 (e.g. 101, 5000, huge numbers) -> 100 (strict cap)
 */
export function parseLimit(limitParam: string | null): number {
  if (limitParam === null || limitParam.trim() === "") {
    return DEFAULT_PAGE_LIMIT;
  }

  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed === 0) {
    return DEFAULT_PAGE_LIMIT;
  }

  if (parsed < 1) {
    return 1;
  }

  return Math.min(parsed, MAX_PAGE_LIMIT);
}

/**
 * Safely parses the `page` query parameter.
 * - Missing, non-numeric, zero, or negative -> defaults to 1.
 * - Caps at 100,000 to prevent integer overflow during arithmetic.
 */
export function parsePage(pageParam: string | null): number {
  if (pageParam === null || pageParam.trim() === "") {
    return 1;
  }

  const parsed = parseInt(pageParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }

  return Math.min(parsed, 100_000);
}

/**
 * GET /api/admin/audit-logs
 *
 * Query parameters:
 * - limit: Number of records to return (default 20, max 100)
 * - page: Page number (1-based, default 1)
 * - offset: Alternative direct offset (non-negative)
 * - action / actionType: Filter by action name
 * - adminId / actorId: Filter by admin ID
 * - entityType: Filter by entity type
 * - startDate: ISO 8601 string bound
 * - endDate: ISO 8601 string bound
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const { searchParams } = request.nextUrl;
    const limitParam = searchParams.get("limit");
    const pageParam = searchParams.get("page");
    const offsetParam = searchParams.get("offset");

    const limit = parseLimit(limitParam);

    let page = parsePage(pageParam);
    let skip: number;

    if (offsetParam !== null && offsetParam.trim() !== "") {
      const parsedOffset = parseInt(offsetParam, 10);
      if (!Number.isNaN(parsedOffset) && parsedOffset >= 0) {
        skip = Math.min(parsedOffset, 10_000_000);
        page = Math.floor(skip / limit) + 1;
      } else {
        skip = (page - 1) * limit;
      }
    } else {
      skip = (page - 1) * limit;
    }

    // Build Prisma where filter
    const where: Record<string, any> = {};

    const action = searchParams.get("action") || searchParams.get("actionType");
    if (action) {
      where.action = action;
    }

    const adminId = searchParams.get("adminId") || searchParams.get("actorId");
    if (adminId) {
      where.adminId = adminId;
    }

    const entityType = searchParams.get("entityType");
    if (entityType) {
      where.entityType = entityType;
    }

    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    if (startDateParam || endDateParam) {
      where.createdAt = {};
      if (startDateParam) {
        const startDate = new Date(startDateParam);
        if (!isNaN(startDate.getTime())) {
          where.createdAt.gte = startDate;
        }
      }
      if (endDateParam) {
        const endDate = new Date(endDateParam);
        if (!isNaN(endDate.getTime())) {
          where.createdAt.lte = endDate;
        }
      }
    }

    const [logs, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        take: limit,
        skip,
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.adminAuditLog.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    const hasNextPage = skip + logs.length < total;

    return NextResponse.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
      },
    });
  } catch (error) {
    console.error("[Admin Audit Logs Query Error]:", error);
    return NextResponse.json(
      { error: "Failed to query audit logs" },
      { status: 500 },
    );
  }
}
