import { autoCreateUpcomingPartitions } from "../../lib/partitionMaintenance";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRawUnsafe: jest.fn(),
  },
}));

describe("autoCreateUpcomingPartitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("executes partition creation query 3 times with monthly intervals", async () => {
    (prisma.$executeRawUnsafe as jest.Mock).mockResolvedValue(1);

    const now = new Date();
    const result = await autoCreateUpcomingPartitions();

    // Verify it generated 3 partitions
    expect(result).toHaveLength(3);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);

    // Verify the query format on the first partition
    const firstQuery = (prisma.$executeRawUnsafe as jest.Mock).mock.calls[0][0];
    expect(firstQuery).toContain("CREATE TABLE IF NOT EXISTS");
    expect(firstQuery).toContain('PARTITION OF "PushNotificationLog"');
    expect(firstQuery).toContain("FOR VALUES FROM");

    // Verify the months match the current, next, and following month sequence
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const currentPartition = `PushNotificationLog_y${year}m${String(month).padStart(2, "0")}`;
    expect(result[0]).toBe(currentPartition);

    const nextDate = new Date(year, month, 1);
    const nextPartition = `PushNotificationLog_y${nextDate.getFullYear()}m${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
    expect(result[1]).toBe(nextPartition);

    const afterNextDate = new Date(year, month + 1, 1);
    const afterNextPartition = `PushNotificationLog_y${afterNextDate.getFullYear()}m${String(afterNextDate.getMonth() + 1).padStart(2, "0")}`;
    expect(result[2]).toBe(afterNextPartition);
  });

  it("propagates database execution errors", async () => {
    const dbError = new Error("Connection failed");
    (prisma.$executeRawUnsafe as jest.Mock).mockRejectedValueOnce(dbError);

    await expect(autoCreateUpcomingPartitions()).rejects.toThrow(
      "Connection failed",
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
