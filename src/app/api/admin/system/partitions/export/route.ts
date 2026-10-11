import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  calculatePartitionDates,
  escapeCsv,
  sanitizeExportFilename,
  validateIso8601Timestamp,
  constructAuditLogFilterConditions,
} from "../dateHelper";

export const dynamic = "force-dynamic";

export type PartitionExportType = "telemetry" | "push" | "audit";

interface ExportRow {
  [key: string]: unknown;
}

const BATCH_SIZE = 1000;

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
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const tableParam =
      searchParams.get("tableName") || searchParams.get("table");
    const typeParam = (
      searchParams.get("type") ||
      (tableParam && tableParam.toLowerCase().includes("push")
        ? "push"
        : tableParam && tableParam.toLowerCase().includes("audit")
          ? "audit"
          : "telemetry")
    ).toLowerCase() as PartitionExportType;

    // Guard against path traversal sequences in table / tableName parameter
    if (tableParam && (tableParam.includes("..") || /[/\\]/.test(tableParam))) {
      return NextResponse.json(
        {
          error: "Invalid table name: path traversal sequences are not allowed",
        },
        { status: 400 },
      );
    }

    const now = new Date();
    const year = yearParam ? parseInt(yearParam, 10) : now.getUTCFullYear();
    const month = monthParam ? parseInt(monthParam, 10) : now.getUTCMonth();

    if (
      isNaN(year) ||
      isNaN(month) ||
      month < 0 ||
      month > 11 ||
      year < 2020 ||
      year > 2100
    ) {
      return NextResponse.json(
        { error: "Invalid year or month parameter" },
        { status: 400 },
      );
    }

    // Extract multi-criteria audit filter parameters
    const actorIdParam =
      searchParams.get("actorId") || searchParams.get("adminId");
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const actionTypeParam =
      searchParams.get("actionType") || searchParams.get("action");

    let customStartDate: Date | null = null;
    let customEndDate: Date | null = null;

    if (startDateParam) {
      customStartDate = validateIso8601Timestamp(startDateParam);
      if (!customStartDate) {
        return NextResponse.json(
          {
            error: `Invalid startDate format: "${startDateParam}". Expected ISO 8601 timestamp.`,
          },
          { status: 400 },
        );
      }
    }

    if (endDateParam) {
      customEndDate = validateIso8601Timestamp(endDateParam);
      if (!customEndDate) {
        return NextResponse.json(
          {
            error: `Invalid endDate format: "${endDateParam}". Expected ISO 8601 timestamp.`,
          },
          { status: 400 },
        );
      }
    }

    const { start, end } = calculatePartitionDates(year, month);
    const startIso = customStartDate
      ? customStartDate.toISOString()
      : start.toISOString();
    const endIso = customEndDate
      ? customEndDate.toISOString()
      : end.toISOString();
    const monthStr = String(month + 1).padStart(2, "0");

    const isAudit =
      typeParam === "audit" ||
      (tableParam ? tableParam.toLowerCase().includes("audit") : false);
    const isTelemetry = !isAudit && typeParam === "telemetry";

    const rawPrefix = tableParam
      ? sanitizeExportFilename(tableParam)
      : isAudit
        ? "audit-logs"
        : isTelemetry
          ? "telemetry-records"
          : "push-logs";
    const rawFilename = `${rawPrefix}-${year}-${monthStr}.csv`;
    const filename = sanitizeExportFilename(rawFilename);

    const auditFilters = isAudit
      ? constructAuditLogFilterConditions({
          actorId: actorIdParam,
          startDate: startIso,
          endDate: endIso,
          actionType: actionTypeParam,
          startParamIndex: 1,
        })
      : null;

    // Support preview / dryRun parameter to return row count and estimated size metadata before export (#5764)
    const isPreview =
      searchParams.get("preview") === "true" ||
      searchParams.get("dryRun") === "true";

    if (isPreview) {
      let rowCount = 0;
      if (isAudit && auditFilters) {
        const countRes = await prisma.$queryRawUnsafe<
          { count: string | number }[]
        >(
          `
          SELECT COUNT(*)::int AS count
          FROM "AdminAuditLog"
          ${auditFilters.whereClause}
        `,
          ...auditFilters.params,
        );
        rowCount = countRes && countRes[0] ? Number(countRes[0].count) : 0;
      } else if (isTelemetry) {
        const countRes = await prisma.$queryRawUnsafe<
          { count: string | number }[]
        >(
          `
          SELECT COUNT(*)::int AS count
          FROM "TelemetryRecord"
          WHERE "timestamp" >= $1::timestamp
            AND "timestamp" < $2::timestamp
        `,
          startIso,
          endIso,
        );
        rowCount = countRes && countRes[0] ? Number(countRes[0].count) : 0;
      } else {
        const countRes = await prisma.$queryRawUnsafe<
          { count: string | number }[]
        >(
          `
          SELECT COUNT(*)::int AS count
          FROM "PushNotificationLog"
          WHERE "createdAt" >= $1::timestamp
            AND "createdAt" < $2::timestamp
        `,
          startIso,
          endIso,
        );
        rowCount = countRes && countRes[0] ? Number(countRes[0].count) : 0;
      }

      // Estimate byte size based on average CSV row size (telemetry ~100 bytes/row, push/audit ~120 bytes/row) + header size
      const headerLength = isAudit ? 80 : isTelemetry ? 95 : 65;
      const avgBytesPerRow = isTelemetry ? 100 : 120;
      const estimatedSizeBytes =
        rowCount > 0 ? headerLength + rowCount * avgBytesPerRow : 0;

      return NextResponse.json({
        success: true,
        preview: true,
        tableName: rawPrefix,
        filename,
        type: typeParam,
        rowCount,
        estimatedSizeBytes,
        partitionRange: {
          start: startIso,
          end: endIso,
          year,
          month: month + 1,
        },
      });
    }

    const headers = isAudit
      ? [
          "id",
          "adminId",
          "action",
          "entityType",
          "entityId",
          "details",
          "createdAt",
        ]
      : isTelemetry
        ? [
            "id",
            "venueId",
            "timestamp",
            "download",
            "upload",
            "latency",
            "noiseLevel",
            "occupancy",
            "presence",
            "crowdLevel",
          ]
        : [
            "id",
            "userId",
            "venueId",
            "title",
            "body",
            "status",
            "error",
            "read",
            "createdAt",
          ];

    // Using Node.js / Web standard TransformStream for streaming response
    const transformStream = new TransformStream();
    const writer = transformStream.writable.getWriter();
    const encoder = new TextEncoder();

    // Stream generation asynchronously without blocking initial HTTP headers
    (async () => {
      let cursorId: string | null = null;
      let aborted = false;

      const abortHandler = () => {
        aborted = true;
      };

      request.signal.addEventListener("abort", abortHandler);

      try {
        // 1. Write CSV header line immediately (starts downloading in < 500ms)
        await writer.write(encoder.encode(headers.join(",") + "\r\n"));

        // 2. Fetch in streaming cursor batches using prisma.$queryRawUnsafe
        let hasMore = true;

        while (hasMore && !aborted && !request.signal.aborted) {
          let rows: ExportRow[] = [];

          if (isAudit && auditFilters) {
            if (cursorId) {
              const cursorParamIdx = auditFilters.nextParamIndex;
              const limitParamIdx = cursorParamIdx + 1;
              const whereSql = auditFilters.whereClause
                ? `${auditFilters.whereClause} AND "id" > $${cursorParamIdx}`
                : `WHERE "id" > $${cursorParamIdx}`;

              rows = await prisma.$queryRawUnsafe<ExportRow[]>(
                `
                SELECT "id", "adminId", "action", "entityType", "entityId", "details", "createdAt"
                FROM "AdminAuditLog"
                ${whereSql}
                ORDER BY "id" ASC
                LIMIT $${limitParamIdx}
              `,
                ...auditFilters.params,
                cursorId,
                BATCH_SIZE,
              );
            } else {
              const limitParamIdx = auditFilters.nextParamIndex;
              rows = await prisma.$queryRawUnsafe<ExportRow[]>(
                `
                SELECT "id", "adminId", "action", "entityType", "entityId", "details", "createdAt"
                FROM "AdminAuditLog"
                ${auditFilters.whereClause}
                ORDER BY "id" ASC
                LIMIT $${limitParamIdx}
              `,
                ...auditFilters.params,
                BATCH_SIZE,
              );
            }
          } else if (isTelemetry) {
            if (cursorId) {
              rows = await prisma.$queryRawUnsafe<ExportRow[]>(
                `
                SELECT "id", "venueId", "timestamp", "download", "upload", "latency", "noiseLevel", "occupancy", "presence", "crowdLevel"
                FROM "TelemetryRecord"
                WHERE "timestamp" >= $1::timestamp
                  AND "timestamp" < $2::timestamp
                  AND "id" > $3
                ORDER BY "id" ASC
                LIMIT $4
              `,
                startIso,
                endIso,
                cursorId,
                BATCH_SIZE,
              );
            } else {
              rows = await prisma.$queryRawUnsafe<ExportRow[]>(
                `
                SELECT "id", "venueId", "timestamp", "download", "upload", "latency", "noiseLevel", "occupancy", "presence", "crowdLevel"
                FROM "TelemetryRecord"
                WHERE "timestamp" >= $1::timestamp
                  AND "timestamp" < $2::timestamp
                ORDER BY "id" ASC
                LIMIT $3
              `,
                startIso,
                endIso,
                BATCH_SIZE,
              );
            }
          } else {
            // Push Notification Log partition export
            if (cursorId) {
              rows = await prisma.$queryRawUnsafe<ExportRow[]>(
                `
                SELECT "id", "userId", "venueId", "title", "body", "status", "error", "read", "createdAt"
                FROM "PushNotificationLog"
                WHERE "createdAt" >= $1::timestamp
                  AND "createdAt" < $2::timestamp
                  AND "id" > $3
                ORDER BY "id" ASC
                LIMIT $4
              `,
                startIso,
                endIso,
                cursorId,
                BATCH_SIZE,
              );
            } else {
              rows = await prisma.$queryRawUnsafe<ExportRow[]>(
                `
                SELECT "id", "userId", "venueId", "title", "body", "status", "error", "read", "createdAt"
                FROM "PushNotificationLog"
                WHERE "createdAt" >= $1::timestamp
                  AND "createdAt" < $2::timestamp
                ORDER BY "id" ASC
                LIMIT $3
              `,
                startIso,
                endIso,
                BATCH_SIZE,
              );
            }
          }

          if (!rows || rows.length === 0) {
            hasMore = false;
            break;
          }

          // Format batch into CSV lines and write to stream chunk
          let chunkText = "";
          for (const row of rows) {
            const formatted = headers.map((h) =>
              escapeCsv(row[h] as string | number | boolean | Date),
            );
            chunkText += formatted.join(",") + "\r\n";
          }

          await writer.write(encoder.encode(chunkText));

          if (rows.length < BATCH_SIZE) {
            hasMore = false;
          } else {
            cursorId = String(rows[rows.length - 1].id);
          }
        }
      } catch (streamErr) {
        if (!aborted) {
          console.error("[Streaming Partition Export Error]:", streamErr);
        }
      } finally {
        request.signal.removeEventListener("abort", abortHandler);
        try {
          await writer.close();
        } catch {
          // Stream already closed or client disconnected
        }
      }
    })();

    // 3. Return streaming response immediately with Transfer-Encoding chunked
    return new NextResponse(transformStream.readable, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment;filename="${filename}"`,
        "Transfer-Encoding": "chunked",
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Admin Partitions Export]", error);
    return NextResponse.json(
      { error: "Failed to export partition logs" },
      { status: 500 },
    );
  }
}

export async function HEAD(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return new NextResponse(null, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const tableParam =
      searchParams.get("tableName") || searchParams.get("table");
    const typeParam = (
      searchParams.get("type") ||
      (tableParam && tableParam.toLowerCase().includes("push")
        ? "push"
        : tableParam && tableParam.toLowerCase().includes("audit")
          ? "audit"
          : "telemetry")
    ).toLowerCase() as PartitionExportType;

    if (tableParam && (tableParam.includes("..") || /[/\\]/.test(tableParam))) {
      return new NextResponse(null, { status: 400 });
    }

    const now = new Date();
    const year = yearParam ? parseInt(yearParam, 10) : now.getUTCFullYear();
    const month = monthParam ? parseInt(monthParam, 10) : now.getUTCMonth();

    if (
      isNaN(year) ||
      isNaN(month) ||
      month < 0 ||
      month > 11 ||
      year < 2020 ||
      year > 2100
    ) {
      return new NextResponse(null, { status: 400 });
    }

    const actorIdParam =
      searchParams.get("actorId") || searchParams.get("adminId");
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const actionTypeParam =
      searchParams.get("actionType") || searchParams.get("action");

    let customStartDate: Date | null = null;
    let customEndDate: Date | null = null;

    if (startDateParam) {
      customStartDate = validateIso8601Timestamp(startDateParam);
      if (!customStartDate) {
        return new NextResponse(null, { status: 400 });
      }
    }

    if (endDateParam) {
      customEndDate = validateIso8601Timestamp(endDateParam);
      if (!customEndDate) {
        return new NextResponse(null, { status: 400 });
      }
    }

    const { start, end } = calculatePartitionDates(year, month);
    const startIso = customStartDate
      ? customStartDate.toISOString()
      : start.toISOString();
    const endIso = customEndDate
      ? customEndDate.toISOString()
      : end.toISOString();
    const monthStr = String(month + 1).padStart(2, "0");

    const isAudit =
      typeParam === "audit" ||
      (tableParam ? tableParam.toLowerCase().includes("audit") : false);
    const isTelemetry = !isAudit && typeParam === "telemetry";

    const rawPrefix = tableParam
      ? sanitizeExportFilename(tableParam)
      : isAudit
        ? "audit-logs"
        : isTelemetry
          ? "telemetry-records"
          : "push-logs";
    const rawFilename = `${rawPrefix}-${year}-${monthStr}.csv`;
    const filename = sanitizeExportFilename(rawFilename);

    let rowCount = 0;
    if (isAudit) {
      const auditFilters = constructAuditLogFilterConditions({
        actorId: actorIdParam,
        startDate: startIso,
        endDate: endIso,
        actionType: actionTypeParam,
        startParamIndex: 1,
      });

      const countRes = await prisma.$queryRawUnsafe<
        { count: string | number }[]
      >(
        `
        SELECT COUNT(*)::int AS count
        FROM "AdminAuditLog"
        ${auditFilters.whereClause}
      `,
        ...auditFilters.params,
      );
      rowCount = countRes && countRes[0] ? Number(countRes[0].count) : 0;
    } else if (isTelemetry) {
      const countRes = await prisma.$queryRawUnsafe<
        { count: string | number }[]
      >(
        `
        SELECT COUNT(*)::int AS count
        FROM "TelemetryRecord"
        WHERE "timestamp" >= $1::timestamp
          AND "timestamp" < $2::timestamp
      `,
        startIso,
        endIso,
      );
      rowCount = countRes && countRes[0] ? Number(countRes[0].count) : 0;
    } else {
      const countRes = await prisma.$queryRawUnsafe<
        { count: string | number }[]
      >(
        `
        SELECT COUNT(*)::int AS count
        FROM "PushNotificationLog"
        WHERE "createdAt" >= $1::timestamp
          AND "createdAt" < $2::timestamp
      `,
        startIso,
        endIso,
      );
      rowCount = countRes && countRes[0] ? Number(countRes[0].count) : 0;
    }

    const headerLength = isAudit ? 80 : isTelemetry ? 95 : 65;
    const avgBytesPerRow = isTelemetry ? 100 : 120;
    const estimatedSizeBytes =
      rowCount > 0 ? headerLength + rowCount * avgBytesPerRow : 0;

    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment;filename="${filename}"`,
        "X-Row-Count": String(rowCount),
        "X-Estimated-Size-Bytes": String(estimatedSizeBytes),
        "X-Partition-Start": startIso,
        "X-Partition-End": endIso,
      },
    });
  } catch (error) {
    console.error("[Admin Partitions Export HEAD]", error);
    return new NextResponse(null, { status: 500 });
  }
}
