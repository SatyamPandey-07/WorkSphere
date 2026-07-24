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
