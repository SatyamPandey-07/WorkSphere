import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  validateIso8601Timestamp,
  constructAuditLogFilterConditions,
} from "../dateHelper";

export const dynamic = "force-dynamic";

export interface AuditLogRow {
  id: string;
  adminId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string | null;
  createdAt: Date | string;
}

/**
 * GET /api/admin/system/partitions/audit
 * Queries partitioned AdminAuditLog records with indexed filters:
 * - actorId (or adminId): filter by admin actor ID
 * - startDate: ISO 8601 timestamp bound for createdAt
 * - endDate: ISO 8601 timestamp bound for createdAt
 * - actionType (or action): filter by action name
 * - limit: max records (default 50, capped at 1000)
 * - offset: pagination offset (default 0)
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
    const actorId = searchParams.get("actorId") || searchParams.get("adminId");
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const actionType =
      searchParams.get("actionType") || searchParams.get("action");
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (startDateParam) {
      startDate = validateIso8601Timestamp(startDateParam);
      if (!startDate) {
        return NextResponse.json(
          {
            error: `Invalid startDate format: "${startDateParam}". Expected ISO 8601 timestamp.`,
          },
          { status: 400 },
        );
      }
    }

    if (endDateParam) {
      endDate = validateIso8601Timestamp(endDateParam);
      if (!endDate) {
        return NextResponse.json(
          {
            error: `Invalid endDate format: "${endDateParam}". Expected ISO 8601 timestamp.`,
          },
          { status: 400 },
        );
      }
    }

    const limit = Math.min(
      Math.max(limitParam ? parseInt(limitParam, 10) : 50, 1),
      1000,
    );
    const offset = Math.max(offsetParam ? parseInt(offsetParam, 10) : 0, 0);

    const filterResult = constructAuditLogFilterConditions({
      actorId,
      startDate,
      endDate,
      actionType,
      startParamIndex: 1,
    });

    const limitIdx = filterResult.nextParamIndex;
    const offsetIdx = limitIdx + 1;
    const queryParams = [...filterResult.params, limit, offset];

    const sql = `
      SELECT "id", "adminId", "action", "entityType", "entityId", "details", "createdAt"
      FROM "AdminAuditLog"
      ${filterResult.whereClause}
      ORDER BY "createdAt" DESC, "id" ASC
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const rows = await prisma.$queryRawUnsafe<AuditLogRow[]>(
      sql,
      ...queryParams,
    );

    return NextResponse.json({
      success: true,
      count: rows.length,
      data: rows,
      filters: {
        actorId: actorId || null,
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
        actionType: actionType || null,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("[Admin Audit Partition Query Error]:", error);
    return NextResponse.json(
      { error: "Failed to query partitioned audit logs" },
      { status: 500 },
    );
  }
}
