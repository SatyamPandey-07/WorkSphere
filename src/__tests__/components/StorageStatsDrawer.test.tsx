import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StorageStatsDrawer } from "@/components/offline/StorageStatsDrawer";
import type { OfflineStorageStats } from "@/lib/offlineStorage";

// Mock offline storage functions
jest.mock("@/lib/offlineStorage", () => ({
  getCachedFloorPlanStorageStats: jest.fn().mockResolvedValue({
    usageBytes: 25690112, // 24.5 MB
    quotaBytes: 104857600, // 100 MB
    usagePercent: 24.5,
    floorPlanBytes: 20971520, // 20 MB
    floorPlanCount: 8,
    floorPlanPercentOfUsage: 81.6,
    floorPlanPercentOfQuota: 20.0,
    isEstimateAvailable: true,
  }),
  getStaleFloorPlanCacheStats: jest.fn().mockResolvedValue({
    count: 2,
    reclaimableBytes: 5242880,
  }),
  purgeStaleFloorPlanCache: jest.fn().mockResolvedValue(2),
  formatBytes: jest.fn(
    (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
  ),
}));

// Mock offlineStore check-in queue
jest.mock("@/lib/offlineStore", () => ({
  getQueuedCheckIns: jest.fn().mockResolvedValue([]),
}));

// Mock SyncQueueManager
jest.mock("@/lib/offline/SyncQueueManager", () => ({
  syncQueueManager: {
    getQueue: jest.fn().mockResolvedValue([]),
  },
}));

const mockStats: OfflineStorageStats = {
  usageBytes: 25690112, // 24.5 MB
  quotaBytes: 104857600,
  usagePercent: 24.5,
  floorPlanBytes: 20971520,
  floorPlanCount: 8,
  floorPlanPercentOfUsage: 81.6,
  floorPlanPercentOfQuota: 20.0,
  isEstimateAvailable: true,
};

describe("StorageStatsDrawer Clear Offline Cache Confirmation Modal", () => {
  it("renders the Clear Offline Cache button when drawer is open", async () => {
    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={jest.fn()}
        initialStats={mockStats}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear offline cache/i,
    });
    expect(clearButton).toBeInTheDocument();
  });

  it("does not wipe cache immediately on button click, but opens confirmation modal", async () => {
    const onClearCache = jest.fn();
    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={jest.fn()}
        initialStats={mockStats}
        onClearCache={onClearCache}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear offline cache/i,
    });
    fireEvent.click(clearButton);

    // Confirmation modal should be open
    expect(
      await screen.findByRole("dialog", { name: /clear offline cache\?/i }),
    ).toBeInTheDocument();
    // Cache has NOT been cleared yet
    expect(onClearCache).not.toHaveBeenCalled();
  });

  it("presents confirmation modal with formatted byte size (e.g. 'Free up 24.5 MB')", async () => {
    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={jest.fn()}
        initialStats={mockStats}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear offline cache/i,
    });
    fireEvent.click(clearButton);

    expect(await screen.findByText(/Free up 24.5 MB/i)).toBeInTheDocument();
  });

  it("warns if unsaved offline check-ins will be discarded", async () => {
    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={jest.fn()}
        initialStats={mockStats}
        initialUnsyncedCheckIns={3}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear offline cache/i,
    });
    fireEvent.click(clearButton);

    const warning = await screen.findByTestId("unsaved-changes-warning");
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent(/unsynced offline check-in drafts/i);
    expect(warning).toHaveTextContent(
      /unsaved offline changes will be discarded/i,
    );
  });

  it("does not show unsaved changes warning if there are no pending check-ins", async () => {
    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={jest.fn()}
        initialStats={mockStats}
        initialUnsyncedCheckIns={0}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear offline cache/i,
    });
    fireEvent.click(clearButton);

    await screen.findByRole("dialog", { name: /clear offline cache\?/i });
    expect(
      screen.queryByTestId("unsaved-changes-warning"),
    ).not.toBeInTheDocument();
  });

  it("provides Cancel button which dismisses confirmation modal without clearing", async () => {
    const onClearCache = jest.fn();
    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={jest.fn()}
        initialStats={mockStats}
        onClearCache={onClearCache}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear offline cache/i,
    });
    fireEvent.click(clearButton);

    const cancelButton = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancelButton).toBeInTheDocument();
    fireEvent.click(cancelButton);

    // Modal dismissed
    expect(
      screen.queryByRole("dialog", { name: /clear offline cache\?/i }),
    ).not.toBeInTheDocument();
    expect(onClearCache).not.toHaveBeenCalled();
  });

  it("provides destructive 'Clear Cache' button which triggers cache wipe upon explicit confirmation", async () => {
    const onClearCache = jest.fn().mockResolvedValue(undefined);
    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={jest.fn()}
        initialStats={mockStats}
        onClearCache={onClearCache}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear offline cache/i,
    });
    fireEvent.click(clearButton);

    const confirmClearButton = screen.getByRole("button", {
      name: /^clear cache$/i,
    });
    expect(confirmClearButton).toBeInTheDocument();
    expect(confirmClearButton.className).toContain("bg-red-600");

    fireEvent.click(confirmClearButton);

    await waitFor(() => {
      expect(onClearCache).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/offline cache successfully cleared!/i),
      ).toBeInTheDocument();
    });
  });

  it("closes confirmation modal when ESC key is pressed without closing entire drawer", async () => {
    const onClose = jest.fn();
    render(
      <StorageStatsDrawer
        isOpen={true}
        onClose={onClose}
        initialStats={mockStats}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: /clear offline cache/i,
    });
    fireEvent.click(clearButton);

    expect(
      screen.getByRole("dialog", { name: /clear offline cache\?/i }),
    ).toBeInTheDocument();

    // Press ESC
    fireEvent.keyDown(window, { key: "Escape" });

    // Modal closes, but drawer onClose was NOT called
    expect(
      screen.queryByRole("dialog", { name: /clear offline cache\?/i }),
    ).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Pressing ESC again now closes the drawer
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
