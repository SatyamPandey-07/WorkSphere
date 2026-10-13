import {
  getStorageBreakdown,
  formatStorageBreakdown,
  DEFAULT_OFFLINE_STORAGE_STATS,
  type OfflineStorageStats,
} from "@/lib/offline/storageStats";

describe("Offline storage stats zero-byte breakdown handling (#5600)", () => {
  it("formats zero-byte breakdown display cleanly as 0 B (0%) without NaN", () => {
    expect(formatStorageBreakdown(0, 0)).toBe("0 B (0%)");
    expect(formatStorageBreakdown(100, 0)).toBe("100 B (0%)");
    expect(formatStorageBreakdown(0, 1024)).toBe("0 B (0%)");
  });

  it("formats non-zero byte breakdown with correct percentage", () => {
    expect(formatStorageBreakdown(256, 1024)).toBe("256 B (25%)");
  });

  it("handles uninitialized IndexedDB zero storage stats gracefully defaulting to 0%", async () => {
    const zeroStats: OfflineStorageStats = {
      ...DEFAULT_OFFLINE_STORAGE_STATS,
      usageBytes: 0,
      floorPlanBytes: 0,
      floorPlanCount: 0,
    };

    const breakdown = await getStorageBreakdown(zeroStats);

    expect(breakdown.totalBytes).toBe(0);
    expect(breakdown.formattedTotal).toBe("0 B");

    for (const cat of breakdown.categories) {
      expect(cat.percentage).toBe(0);
      expect(cat.formattedPercent).toBe("0%");
      expect(cat.formattedBytes).toBe("0 B");
      expect(cat.formattedPercent).not.toContain("NaN");
    }
  });

  it("calculates category percentages correctly when storage is populated", async () => {
    const populatedStats: OfflineStorageStats = {
      ...DEFAULT_OFFLINE_STORAGE_STATS,
      usageBytes: 1000,
      floorPlanBytes: 400,
      floorPlanCount: 2,
    };

    const breakdown = await getStorageBreakdown(populatedStats);

    expect(breakdown.totalBytes).toBe(1000);
    const fpCategory = breakdown.categories.find((c) => c.name === "Floor Plans");
    const metaCategory = breakdown.categories.find((c) => c.name === "Metadata & Cache");

    expect(fpCategory?.percentage).toBe(40);
    expect(fpCategory?.formattedPercent).toBe("40%");

    expect(metaCategory?.percentage).toBe(60);
    expect(metaCategory?.formattedPercent).toBe("60%");
  });
});
