import { NextResponse } from "next/server";
 feature/protobuf-binary-broker
import { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
 main

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Ensure Upcoming Partitions for the Next 4 Weeks Exist
    await prisma.$executeRawUnsafe(`
      SELECT create_weekly_telemetry_partition(NOW() + (i || ' weeks')::interval)
      FROM generate_series(0, 4) AS i;
    `);

    // 2. Identify Partitions Older Than 90 Days
 feature/protobuf-binary-broker
    const expiredPartitions = await prisma.$queryRaw<Array<{ relname: string }>>`

    const expiredPartitions = await prisma.$queryRaw<
      Array<{ relname: string }>
    >`
 main
      SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      WHERE parent.relname = 'TelemetryReading'
        AND c.relname ~ '^telemetry_reading_y[0-9]{4}_w[0-9]{2}$'
        AND pg_catalog.obj_description(c.oid, 'pg_class') IS NULL;
    `;

    const archivedPartitions: string[] = [];

    // 3. Detach & Drop Partitions Older Than 90 Days (Cold Storage Archival)
    for (const partition of expiredPartitions) {
 feature/protobuf-binary-broker
      const match = partition.relname.match(/^telemetry_reading_y(\d{4})_w(\d{2})$/);
      if (match) {
        const [, year, week] = match;
        // Check if partition end boundary is > 90 days ago
        const partitionEndDateQuery = await prisma.$queryRaw<Array<{ is_expired: boolean }>>`

      const match = partition.relname.match(
        /^telemetry_reading_y(\d{4})_w(\d{2})$/,
      );
      if (match) {
        const [, year, week] = match;
        // Check if partition end boundary is > 90 days ago
        const partitionEndDateQuery = await prisma.$queryRaw<
          Array<{ is_expired: boolean }>
        >`
 main
          SELECT (to_date(${year} || ${week}, 'IYYYIW') + INTERVAL '1 week') < (NOW() - INTERVAL '90 days') AS is_expired;
        `;

        if (partitionEndDateQuery[0]?.is_expired) {
          // Detach concurrently to avoid locks
          await prisma.$executeRawUnsafe(
 feature/protobuf-binary-broker
            `ALTER TABLE "TelemetryReading" DETACH PARTITION "${partition.relname}" CONCURRENTLY;`
          );
          // Drop partition table after detachment
          await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.relname}";`);

            `ALTER TABLE "TelemetryReading" DETACH PARTITION "${partition.relname}" CONCURRENTLY;`,
          );
          // Drop partition table after detachment
          await prisma.$executeRawUnsafe(
            `DROP TABLE IF EXISTS "${partition.relname}";`,
          );
 main
          archivedPartitions.push(partition.relname);
        }
      }
    }

    return NextResponse.json({
      success: true,
      archivedPartitions,
 feature/protobuf-binary-broker
      message: "Weekly telemetry partitions created & retention policies executed.",

      message:
        "Weekly telemetry partitions created & retention policies executed.",
 main
    });
  } catch (error: any) {
    console.error("Partition Maintenance Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}