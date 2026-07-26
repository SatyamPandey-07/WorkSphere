import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { calculatePartitionDates } from "../dateHelper";

export const dynamic = "force-dynamic";

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

    const logs = await prisma.pushNotificationLog.findMany({
      where: {
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        venueId: true,
        title: true,
        body: true,
        status: true,
        error: true,
        read: true,
        createdAt: true,
      },
    });

    const csvRows: string[] = [
      "id,userId,venueId,title,body,status,error,read,createdAt",
    ];

    for (const log of logs) {
      csvRows.push(
        [
          escapeCsv(log.id),
          escapeCsv(log.userId),
          escapeCsv(log.venueId ?? ""),
          escapeCsv(log.title),
          escapeCsv(log.body),
          escapeCsv(log.status),
          escapeCsv(log.error ?? ""),
          log.read ? "true" : "false",
          log.createdAt.toISOString(),
        ].join(","),
      );
    }

    const csv = csvRows.join("\r\n");
    const filename = `push-logs-${year}-${String(month + 1).padStart(2, "0")}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
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

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
