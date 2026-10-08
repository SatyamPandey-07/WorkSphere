import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { calculatePartitionDates, escapeCsv } from "../dateHelper";

export const dynamic = "force-dynamic";

export type PartitionExportType = "telemetry" | "push";

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
    const typeParam = (
      searchParams.get("type") || "telemetry"
    ).toLowerCase() as PartitionExportType;

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

    const { start, end } = calculatePartitionDates(year, month);
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const monthStr = String(month + 1).padStart(2, "0");

    const isTelemetry = typeParam === "telemetry";
    const filename = isTelemetry
      ? `telemetry-records-${year}-${monthStr}.csv`
      : `push-logs-${year}-${monthStr}.csv`;

    const headers = isTelemetry
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

          if (isTelemetry) {
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
        "Content-Disposition": `attachment; filename="${filename}"`,
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
