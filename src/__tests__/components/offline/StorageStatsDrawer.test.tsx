import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  StorageStatsDrawer,
} from "@/components/offline/StorageStatsDrawer";
import {
  getCachedFloorPlanStorageStats,
  getStaleFloorPlanCacheStats,
  purgeStaleFloorPlanCache,
} from "@/lib/offlineStorage";
import { getQueuedCheckIns } from "@/lib/offlineStore";
import { syncQueueManager } from "@/lib/offline/SyncQueueManager";

jest.mock("@/lib/offlineStorage", () => ({
  getCachedFloorPlanStorageStats: jest.fn(),
  getStaleFloorPlanCacheStats: jest.fn(),
  purgeStaleFloorPlanCache: jest.fn(),
  formatBytes: jest.fn((bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }),
}));

jest.mock("@/lib/offlineStore", () => ({
  getQueuedCheckIns: jest.fn(),
}));

jest.mock("@/lib/offline/SyncQueueManager", () => ({
  syncQueueManager: {
    getQueue: jest.fn(),
  },
}));

const mockGetCachedFloorPlanStorageStats =
  getCachedFloorPlanStorageStats as jest.MockedFunction<
    typeof getCachedFloorPlanStorageStats
  >;
const mockGetStaleFloorPlanCacheStats =
  getStaleFloorPlanCacheStats as jest.MockedFunction<
    typeof getStaleFloorPlanCacheStats
  >;
const mockPurgeStaleFloorPlanCache =
  purgeStaleFloorPlanCache as jest.MockedFunction<
    typeof purgeStaleFloorPlanCache
  >;
const mockGetQueuedCheckIns = getQueuedCheckIns as jest.MockedFunction<
  typeof getQueuedCheckIns
>;
const mockGetQueue = syncQueueManager.getQueue as jest.Mock;

describe("StorageStatsDrawer Component (#6899)", () => {
  const mockOnClose = jest.fn();
  const mockOnStatsUpdated = jest.fn();

  const sampleHealthyStats = {
    usageBytes: 25 * 1024 * 1024,
    quotaBytes: 100 * 1024 * 1024,
    usagePercent: 25,
    floorPlanBytes: 10 * 1024 * 1024,
    floorPlanCount: 8,
    floorPlanPercentOfUsage: 40,
    floorPlanPercentOfQuota: 10,
    isEstimateAvailable: true,
  };

  const sampleStaleStats = {
    count: 3,
    reclaimableBytes: 6 * 1024 * 1024,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedFloorPlanStorageStats.mockResolvedValue(sampleHealthyStats);
    mockGetStaleFloorPlanCacheStats.mockResolvedValue(sampleStaleStats);
    mockPurgeStaleFloorPlanCache.mockResolvedValue(undefined);
    mockGetQueuedCheckIns.mockResolvedValue([]);
    mockGetQueue.mockResolvedValue([]);
  });

  describe("Visibility & Initial Render", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <StorageStatsDrawer isOpen={false} onClose={mockOnClose} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("displays loading spinner when initialStats is not provided before data resolves", () => {
      mockGetCachedFloorPlanStorageStats.mockImplementation(
        () => new Promise(() => {}),
      );

      render(<StorageStatsDrawer isOpen={true} onClose={mockOnClose} />);

      expect(
        screen.getByTestId("storage-stats-loading-spinner"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Estimating browser storage quota…/i),
      ).toBeInTheDocument();
    });

    it("renders drawer with initialStats immediately without loading state", async () => {
      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
          />,
        );
      });

      expect(screen.getByTestId("storage-stats-drawer")).toBeInTheDocument();
      expect(
        screen.getByText("Storage & Quota Stats"),
      ).toBeInTheDocument();
      expect(screen.getByText("25.0% Quota Used")).toBeInTheDocument();
      expect(screen.getByText("Healthy")).toBeInTheDocument();
      expect(screen.getByTestId("storage-stats-plans-count")).toHaveTextContent(
        "8",
      );
    });
  });

  describe("Storage Health Badges & Quota Percentages", () => {
    it("displays 'Heavy Usage' badge when quota usage is between 70% and 90%", async () => {
      const heavyStats = {
        ...sampleHealthyStats,
        usagePercent: 78,
      };
      mockGetCachedFloorPlanStorageStats.mockResolvedValue(heavyStats);

      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={heavyStats}
          />,
        );
      });

      expect(screen.getByText("Heavy Usage")).toBeInTheDocument();
      expect(screen.getByText("78.0% Quota Used")).toBeInTheDocument();
    });

    it("displays 'Quota Warning' badge when quota usage exceeds 90%", async () => {
      const warningStats = {
        ...sampleHealthyStats,
        usagePercent: 95,
      };
      mockGetCachedFloorPlanStorageStats.mockResolvedValue(warningStats);

      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={warningStats}
          />,
        );
      });

      expect(screen.getByText("Quota Warning")).toBeInTheDocument();
      expect(screen.getByText("95.0% Quota Used")).toBeInTheDocument();
    });

    it("sanitizes negative or NaN usagePercent values to 0%", async () => {
      const nanStats = {
        ...sampleHealthyStats,
        usagePercent: NaN as any,
      };
      mockGetCachedFloorPlanStorageStats.mockResolvedValue(nanStats);

      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={nanStats}
          />,
        );
      });

      expect(screen.getByText("0.0% Quota Used")).toBeInTheDocument();
      expect(screen.getByText("Healthy")).toBeInTheDocument();
    });
  });

  describe("Actions & Refreshing", () => {
    it("refreshes stats when refresh button is clicked", async () => {
      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
            onStatsUpdated={mockOnStatsUpdated}
          />,
        );
      });

      const refreshBtn = screen.getByTestId("storage-stats-refresh-btn");
      await act(async () => {
        fireEvent.click(refreshBtn);
      });

      expect(mockGetCachedFloorPlanStorageStats).toHaveBeenCalled();
      expect(mockGetStaleFloorPlanCacheStats).toHaveBeenCalled();
      expect(mockOnStatsUpdated).toHaveBeenCalledWith(sampleHealthyStats);
    });

    it("displays error banner when getCachedFloorPlanStorageStats throws", async () => {
      mockGetCachedFloorPlanStorageStats.mockRejectedValue(
        new Error("IDB Storage Error"),
      );

      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={null}
          />,
        );
      });

      expect(
        screen.getByTestId("storage-stats-error-message"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Unable to retrieve storage quota details./i),
      ).toBeInTheDocument();
    });
  });

  describe("Stale Floor Plan Cache Purge Modal Flow", () => {
    it("opens clean confirmation modal and executes purge on proceed", async () => {
      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
          />,
        );
      });

      // Verify stale stats text
      expect(
        screen.getByText(/6.00 MB reclaimable from 3 plans older than 30 days./i),
      ).toBeInTheDocument();

      const purgeBtn = screen.getByTestId("storage-stats-purge-stale-btn");
      fireEvent.click(purgeBtn);

      expect(screen.getByTestId("confirm-purge-modal")).toBeInTheDocument();
      expect(
        screen.getByText("Clean stale floor plans?"),
      ).toBeInTheDocument();

      const proceedBtn = screen.getByTestId("confirm-purge-proceed-btn");
      await act(async () => {
        fireEvent.click(proceedBtn);
      });

      expect(mockPurgeStaleFloorPlanCache).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId("confirm-purge-modal"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("storage-stats-success-message"),
      ).toHaveTextContent("Stale cache successfully purged!");
    });

    it("cancels stale cache cleanup when cancel button is clicked", async () => {
      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
          />,
        );
      });

      fireEvent.click(screen.getByTestId("storage-stats-purge-stale-btn"));
      expect(screen.getByTestId("confirm-purge-modal")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("confirm-purge-cancel-btn"));
      expect(
        screen.queryByTestId("confirm-purge-modal"),
      ).not.toBeInTheDocument();
      expect(mockPurgeStaleFloorPlanCache).not.toHaveBeenCalled();
    });
  });

  describe("Clear Offline Cache Modal & Warnings", () => {
    it("opens clear cache confirmation modal and displays unsaved checkins warning", async () => {
      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
            initialUnsyncedCheckIns={2}
          />,
        );
      });

      fireEvent.click(screen.getByTestId("storage-stats-clear-cache-btn"));

      expect(
        screen.getByTestId("confirm-clear-cache-modal"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("unsaved-changes-warning"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/You have 2 unsynced offline check-in drafts/i),
      ).toBeInTheDocument();
    });

    it("calls onClearCache prop when provided and executes clear", async () => {
      const mockOnClearCache = jest.fn().mockResolvedValue(undefined);

      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
            onClearCache={mockOnClearCache}
          />,
        );
      });

      fireEvent.click(screen.getByTestId("storage-stats-clear-cache-btn"));
      const proceedBtn = screen.getByTestId("confirm-clear-cache-proceed-btn");

      await act(async () => {
        fireEvent.click(proceedBtn);
      });

      expect(mockOnClearCache).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId("confirm-clear-cache-modal"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("storage-stats-success-message"),
      ).toHaveTextContent("Offline cache successfully cleared!");
    });
  });

  describe("Dismissal & Keyboard Navigation", () => {
    it("calls onClose when header close button or footer close button is clicked", async () => {
      let renderResult: any;
      await act(async () => {
        renderResult = render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
          />,
        );
      });

      fireEvent.click(screen.getByTestId("storage-stats-close-btn"));
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      await act(async () => {
        renderResult.rerender(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
          />,
        );
      });

      fireEvent.click(
        screen.getByTestId("storage-stats-drawer-close-footer-btn"),
      );
      expect(mockOnClose).toHaveBeenCalledTimes(2);
    });

    it("dismisses on backdrop click", async () => {
      let container: any;
      await act(async () => {
        const res = render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
          />,
        );
        container = res.container;
      });

      const backdrop = container.firstChild as HTMLElement;
      fireEvent.click(backdrop);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("closes drawer when Escape key is pressed and no submodal is open", async () => {
      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
          />,
        );
      });

      fireEvent.keyDown(window, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("closes open confirmation modal first on Escape instead of entire drawer", async () => {
      await act(async () => {
        render(
          <StorageStatsDrawer
            isOpen={true}
            onClose={mockOnClose}
            initialStats={sampleHealthyStats}
          />,
        );
      });

      fireEvent.click(screen.getByTestId("storage-stats-purge-stale-btn"));
      expect(screen.getByTestId("confirm-purge-modal")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });

      // Submodal is closed, but drawer remains open
      expect(
        screen.queryByTestId("confirm-purge-modal"),
      ).not.toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
