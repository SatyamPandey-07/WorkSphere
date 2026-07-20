import { prisma } from "@/lib/prisma";

export type RangeKey = "7d" | "30d" | "90d";

export const RANGE_DAYS: Record<RangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function startDateForRange(range: RangeKey) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[range] - 1));
  return start;
}

export function isoDay(value: Date | number | string) {
  return new Date(value).toISOString().slice(0, 10);
}

export function createDaySeries(start: Date) {
  const result: Record<string, number> = {};
  const cursor = new Date(start);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  while (cursor <= today) {
    result[isoDay(cursor)] = 0;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function parseEmailRange(value: string | null): RangeKey {
  return value === "7d" || value === "90d" ? value : "30d";
}

export type EmailMetrics = {
  range: RangeKey;
  generatedAt: string;
  overview: {
    totalSent: number;
    totalFailed: number;
    totalPending: number;
    bounceRate: number;
    sentToday: number;
    failedToday: number;
  };
  trend: Array<{
    date: string;
    sent: number;
    failed: number;
  }>;
  byType: Array<{
    type: string;
    sent: number;
    failed: number;
    total: number;
  }>;
  logs: Array<{
    id: string;
    type: string;
    recipient: string;
    subject: string;
    status: string;
    error: string | null;
    createdAt: string;
  }>;
  logsTotal: number;
};

export async function getAdminEmailMetrics(range: RangeKey, page = 1, pageSize = 20, search?: string): Promise<EmailMetrics> {
  const startDate = startDateForRange(range);
  const skip = (page - 1) * pageSize;

  const whereBase = { createdAt: { gte: startDate } } as any;
  const whereSearch = search
    ? {
        createdAt: { gte: startDate },
        OR: [
          { recipient: { contains: search, mode: "insensitive" } },
          { subject: { contains: search, mode: "insensitive" } },
        ],
      }
    : whereBase;

  const [totalSent, totalFailed, totalPending, sentToday, failedToday, trend, byType, logs, logsTotal] = await Promise.all([
    prisma.emailLog.count({ where: { ...whereBase, status: "SENT" } }),
    prisma.emailLog.count({ where: { ...whereBase, status: "FAILED" } }),
    prisma.emailLog.count({ where: { ...whereBase, status: "PENDING" } }),
    prisma.emailLog.count({
      where: {
        status: "SENT",
        createdAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
      },
    }),
    prisma.emailLog.count({
      where: {
        status: "FAILED",
        createdAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
      },
    }),
    getTrend(range),
    prisma.emailLog.groupBy({
      by: ["type"],
      where: whereBase,
      _count: { _all: true },
    }),
    prisma.emailLog.findMany({
      where: whereSearch,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: { id: true, type: true, recipient: true, subject: true, status: true, error: true, createdAt: true },
    }),
    prisma.emailLog.count({ where: whereSearch }),
  ]);

  const typeBreakdown = await Promise.all(
    byType.map(async (entry) => {
      const sent = await prisma.emailLog.count({
        where: { type: entry.type, status: "SENT", createdAt: { gte: startDate } },
      });
      const failed = await prisma.emailLog.count({
        where: { type: entry.type, status: "FAILED", createdAt: { gte: startDate } },
      });
      return { type: entry.type, sent, failed, total: entry._count._all };
    }),
  );

  typeBreakdown.sort((a, b) => b.total - a.total);

  const total = totalSent + totalFailed + totalPending;
  const bounceRate = total > 0 ? Number(((totalFailed / total) * 100).toFixed(1)) : 0;

  return {
    range,
    generatedAt: new Date().toISOString(),
    overview: { totalSent, totalFailed, totalPending, bounceRate, sentToday, failedToday },
    trend,
    byType: typeBreakdown,
    logs: logs.map((l) => ({
      ...l,
      type: l.type,
      createdAt: l.createdAt.toISOString(),
    })),
    logsTotal,
  };
}

async function getTrend(range: RangeKey) {
  const startDate = startDateForRange(range);
  const rows = await prisma.$queryRaw<{ day: string; sent: number; failed: number }[]>`
    SELECT
      TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      COUNT(*) FILTER (WHERE "status" = 'SENT')::int AS sent,
      COUNT(*) FILTER (WHERE "status" = 'FAILED')::int AS failed
    FROM "EmailLog"
    WHERE "createdAt" >= ${startDate}
    GROUP BY day
    ORDER BY day ASC
  `;

  const series = createDaySeries(startDate);
  for (const row of rows) {
    if (row.day in series) {
      series[row.day] = row.sent;
    }
  }

  const failedMap = new Map<string, number>();
  for (const row of rows) {
    failedMap.set(row.day, row.failed);
  }

  return Object.entries(series).map(([date, sent]) => ({
    date,
    sent,
    failed: failedMap.get(date) ?? 0,
  }));
}
