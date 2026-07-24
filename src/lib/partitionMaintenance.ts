import { prisma } from "@/lib/prisma";

/**
 * Automates time-based declarative table partitioning for PushNotificationLog.
 * Checks and creates monthly range partitions for the current month, next month,
 * and the month after next, ensuring no partition gaps exist.
 */
export async function autoCreateUpcomingPartitions(): Promise<string[]> {
  const now = new Date();
  const createdPartitions: string[] = [];

  // Pre-create partitions for offset 0 (current month), 1 (next month), and 2 (month after next)
  for (let offset = 0; offset <= 2; offset++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, "0");

    const nextTargetDate = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth() + 1,
      1,
    );
    const nextYear = nextTargetDate.getFullYear();
    const nextMonth = String(nextTargetDate.getMonth() + 1).padStart(2, "0");

    const partitionName = `PushNotificationLog_y${year}m${month}`;
    const rangeStart = `${year}-${month}-01 00:00:00`;
    const rangeEnd = `${nextYear}-${nextMonth}-01 00:00:00`;

    const query = `
      CREATE TABLE IF NOT EXISTS "${partitionName}" 
      PARTITION OF "PushNotificationLog"
      FOR VALUES FROM ('${rangeStart}') TO ('${rangeEnd}')
    `;

    try {
      await prisma.$executeRawUnsafe(query);
      createdPartitions.push(partitionName);
      console.log(`Ensured partition exists: ${partitionName}`);
    } catch (error) {
      console.error(`Failed to create partition ${partitionName}:`, error);
      throw error;
    }
  }

  return createdPartitions;
}
export interface PartitionHealthReport {
  status: "HEALTHY" | "CRITICAL";
  checkedAt: string;
  partitions: {
    name: string;
    exists: boolean;
    rowCount: number;
  }[];
}

export async function checkPartitionHealth(): Promise<PartitionHealthReport> {
  const now = new Date();
  const partitionsReport: any[] = [];
  let isCritical = false;

  // Track the current month (offset 0) and the next month (offset 1)
  for (let offset = 0; offset <= 1; offset++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, "0");
    const partitionName = `PushNotificationLog_y${year}m${month}`;

    try {
      // Query PostgreSQL system catalogs to verify if the partition sub-table exists
      const result = await prisma.$queryRawUnsafe<{ relname: string; n_live_tup: number }[]>(`
        SELECT relname, n_live_tup::int as n_live_tup
        FROM pg_stat_user_tables 
        WHERE relname = '${partitionName}'
        LIMIT 1;
      `);

      const exists = result && result.length > 0;
      const rowCount = exists ? (result[0] as any).n_live_tup : 0;

      // If next month's partition (offset 1) is missing, mark the state as CRITICAL
      if (offset === 1 && !exists) {
        isCritical = true;
      }

      partitionsReport.push({
        name: partitionName,
        exists,
        rowCount,
      });
    } catch (error) {
      console.error(`Error checking status for table partition ${partitionName}:`, error);
      isCritical = true;
    }
  }

  return {
    status: isCritical ? "CRITICAL" : "HEALTHY",
    checkedAt: new Date().toISOString(),
    partitions: partitionsReport,
  };
}