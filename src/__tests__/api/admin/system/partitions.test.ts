import { calculatePartitionDates } from "../../../../app/api/admin/system/partitions/dateHelper";

jest.mock("../../../../lib/partitionMaintenance", () => ({
  checkPartitionHealth: jest.fn(),
}));

describe("Partition Date Calculations", () => {
  it("verifying leap year February partition range formatting (Feb 1 to Mar 1)", () => {
    // 2024 is a leap year, month 1 is February (0-indexed)
    const { start, end } = calculatePartitionDates(2024, 1);

    expect(start.toISOString().substring(0, 10)).toBe("2024-02-01");
    expect(end.toISOString().substring(0, 10)).toBe("2024-03-01");
  });
});
