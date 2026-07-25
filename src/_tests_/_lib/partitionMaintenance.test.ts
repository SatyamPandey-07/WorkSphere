import { checkPartitionHealth } from "../../lib/partitionMaintenance";
import { prisma } from "../../lib/prisma";

jest.mock("../../lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

describe("checkPartitionHealth()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return HEALTHY when all upcoming partitions exist", async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
      { relname: "PushNotificationLog_y2026m08", n_live_tup: 100 },
    ]);

    const report = await checkPartitionHealth();
    expect(report.status).toBe("HEALTHY");
    expect(report.partitions[0].exists).toBe(true);
  });

  it("should return CRITICAL when an upcoming partition is missing", async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([]);

    const report = await checkPartitionHealth();
    expect(report.status).toBe("CRITICAL");
  });
});
