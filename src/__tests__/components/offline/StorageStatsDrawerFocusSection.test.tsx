import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { StorageStatsDrawer } from "@/components/offline/StorageStatsDrawer";

// Mock offline storage utilities
jest.mock("@/lib/offlineStorage", () => ({
  getCachedFloorPlanStorageStats: jest.fn().mockResolvedValue({
    usageBytes: 850 * 1024 * 1024,
    quotaBytes: 1000 * 1024 * 1024,
    usagePercent: 85,
    floorPlanBytes: 200 * 1024 * 1024,
    floorPlanCount: 12,
    floorPlanPercentOfUsage: 23.5,
    floorPlanPercentOfQuota: 20,
    isEstimateAvailable: true,
  }),
  getStaleFloorPlanCacheStats: jest.fn().mockResolvedValue({
    count: 3,
    reclaimableBytes: 15 * 1024 * 1024,
  }),
  purgeStaleFloorPlanCache: jest.fn().mockResolvedValue(undefined),
  formatBytes: jest.fn(
    (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`,
  ),
}));

jest.mock("@/lib/offlineStore", () => ({
  getQueuedCheckIns: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/offline/SyncQueueManager", () => ({
  syncQueueManager: {
    getQueue: jest.fn().mockResolvedValue([]),
    resetDatabaseNonDestructive: jest
      .fn()
      .mockResolvedValue({ restoredCount: 0 }),
  },
}));

describe("StorageStatsDrawer initialFocusSection prop (#7946)", () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("scrolls cleanup section into view and focuses clear cache button when initialFocusSection is 'cleanup'", async () => {
    const scrollIntoViewMock = jest.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={mockOnClose}
        initialFocusSection="cleanup"
      />,
    );

    // Wait for drawer content to render
    await waitFor(() => {
      expect(
        screen.getByTestId("storage-stats-cleanup-section"),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
      const clearBtn = screen.getByTestId("storage-stats-clear-cache-btn");
      expect(document.activeElement).toBe(clearBtn);
    });
  });

  it("does not scroll or auto-focus cleanup section when initialFocusSection is omitted", async () => {
    const scrollIntoViewMock = jest.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    render(<StorageStatsDrawer isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("storage-stats-cleanup-section"),
      ).toBeInTheDocument();
    });

    // Let the timer tick
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    const clearBtn = screen.getByTestId("storage-stats-clear-cache-btn");
    expect(document.activeElement).not.toBe(clearBtn);
  });
});
