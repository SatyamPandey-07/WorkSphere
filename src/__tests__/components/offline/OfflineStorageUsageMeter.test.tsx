import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import OfflineStorageUsageMeter from "@/components/offline/OfflineStorageUsageMeter";
import * as offlineStorageModule from "@/lib/offlineStorage";

jest.mock("@/lib/offlineStorage", () => ({
  ...jest.requireActual("@/lib/offlineStorage"),
  getCachedFloorPlanStorageStats: jest.fn(),
  getStaleFloorPlanCacheStats: jest.fn(),
  purgeStaleFloorPlanCache: jest.fn(),
}));

const mockGetCachedFloorPlanStorageStats =
  offlineStorageModule.getCachedFloorPlanStorageStats as jest.MockedFunction<
    typeof offlineStorageModule.getCachedFloorPlanStorageStats
  >;
const mockGetStaleFloorPlanCacheStats =
  offlineStorageModule.getStaleFloorPlanCacheStats as jest.MockedFunction<
    typeof offlineStorageModule.getStaleFloorPlanCacheStats
  >;
const mockPurgeStaleFloorPlanCache =
  offlineStorageModule.purgeStaleFloorPlanCache as jest.MockedFunction<
    typeof offlineStorageModule.purgeStaleFloorPlanCache
  >;

describe("OfflineStorageUsageMeter Component", () => {
  const defaultStats: offlineStorageModule.OfflineStorageStats = {
    usageBytes: 40 * 1024 * 1024,
    quotaBytes: 100 * 1024 * 1024,
    usagePercent: 40.0,
    floorPlanBytes: 15 * 1024 * 1024,
    floorPlanCount: 3,
    floorPlanPercentOfUsage: 37.5,
    isEstimateAvailable: true,
  };

  const defaultStaleStats: offlineStorageModule.StaleFloorPlanCacheStats = {
    count: 2,
    reclaimableBytes: 10 * 1024 * 1024,
    staleIds: ["plan-1", "plan-2"],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedFloorPlanStorageStats.mockResolvedValue({ ...defaultStats });
    mockGetStaleFloorPlanCacheStats.mockResolvedValue({ ...defaultStaleStats });
    mockPurgeStaleFloorPlanCache.mockResolvedValue({
      purgedCount: 2,
      freedBytes: 10 * 1024 * 1024,
      purgedIds: ["plan-1", "plan-2"],
    });
  });

  describe("Loading State & Initialization", () => {
    it("renders loading skeleton while initial stats are resolving", async () => {
      let resolvePromise: (value: offlineStorageModule.OfflineStorageStats) => void;
      mockGetCachedFloorPlanStorageStats.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
      );

      render(<OfflineStorageUsageMeter />);

      expect(screen.getByTestId("storage-meter-loading")).toBeInTheDocument();
      expect(screen.getByTestId("storage-meter-loading")).toHaveAttribute("aria-busy", "true");

      await act(async () => {
        resolvePromise!(defaultStats);
      });

      await waitFor(() => {
        expect(screen.queryByTestId("storage-meter-loading")).not.toBeInTheDocument();
        expect(screen.getByTestId("offline-storage-usage-meter")).toBeInTheDocument();
      });
    });
  });

  describe("Quota Status Badges & Progressbar", () => {
    it("renders Healthy badge when quota usage is under 70%", async () => {
      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-status-badge")).toHaveTextContent("Healthy");
      });

      const progressbar = screen.getByTestId("storage-meter-progressbar");
      expect(progressbar).toHaveAttribute("aria-valuenow", "40");
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "100");
    });

    it("renders Heavy Usage badge when quota usage is between 70% and 90%", async () => {
      mockGetCachedFloorPlanStorageStats.mockResolvedValue({
        ...defaultStats,
        usagePercent: 78.5,
      });

      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-status-badge")).toHaveTextContent("Heavy Usage");
      });
    });

    it("renders Quota Warning badge when quota usage exceeds 90%", async () => {
      mockGetCachedFloorPlanStorageStats.mockResolvedValue({
        ...defaultStats,
        usagePercent: 94.2,
      });

      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-status-badge")).toHaveTextContent("Quota Warning");
      });
    });

    it("sanitizes non-finite NaN usagePercent cleanly", async () => {
      mockGetCachedFloorPlanStorageStats.mockResolvedValue({
        ...defaultStats,
        usagePercent: NaN,
      });

      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-progressbar")).toHaveAttribute(
          "aria-valuenow",
          "0",
        );
      });
    });
  });

  describe("Metrics Cards & Callback", () => {
    it("renders floor plans count and formatted bytes", async () => {
      const mockOnStatsUpdated = jest.fn();
      render(<OfflineStorageUsageMeter onStatsUpdated={mockOnStatsUpdated} />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-floorplan-card")).toBeInTheDocument();
      });

      expect(screen.getByText("3 plans saved")).toBeInTheDocument();
      expect(screen.getByText("38% of cache")).toBeInTheDocument();
      expect(mockOnStatsUpdated).toHaveBeenCalledWith(expect.objectContaining({ floorPlanCount: 3 }));
    });

    it("refreshes stats when clicking the refresh button", async () => {
      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-refresh-btn")).toBeInTheDocument();
      });

      const refreshBtn = screen.getByTestId("storage-meter-refresh-btn");
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(mockGetCachedFloorPlanStorageStats).toHaveBeenCalledTimes(2);
        expect(mockGetStaleFloorPlanCacheStats).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("Clean Stale Cache Dialog & Actions", () => {
    it("renders stale cache information and enables Clean button", async () => {
      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByText(/10.00 MB reclaimable from 2 stale floor plans/i)).toBeInTheDocument();
      });

      const cleanBtn = screen.getByTestId("storage-meter-clean-btn");
      expect(cleanBtn).not.toBeDisabled();
    });

    it("opens confirmation dialog when clicking Clean button", async () => {
      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-clean-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("storage-meter-clean-btn"));

      const dialog = screen.getByTestId("clean-stale-cache-dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("role", "dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(screen.getByText("Clean stale floor plans?")).toBeInTheDocument();
    });

    it("dismisses dialog when clicking Cancel", async () => {
      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-clean-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("storage-meter-clean-btn"));
      expect(screen.getByTestId("clean-stale-cache-dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("clean-stale-cancel-btn"));
      expect(screen.queryByTestId("clean-stale-cache-dialog")).not.toBeInTheDocument();
      expect(mockPurgeStaleFloorPlanCache).not.toHaveBeenCalled();
    });

    it("dismisses dialog when pressing Escape key", async () => {
      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-clean-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("storage-meter-clean-btn"));
      expect(screen.getByTestId("clean-stale-cache-dialog")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
      expect(screen.queryByTestId("clean-stale-cache-dialog")).not.toBeInTheDocument();
    });

    it("executes purgeStaleFloorPlanCache and refreshes stats on confirmation", async () => {
      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-clean-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("storage-meter-clean-btn"));
      const confirmBtn = screen.getByTestId("clean-stale-confirm-btn");
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockPurgeStaleFloorPlanCache).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId("clean-stale-cache-dialog")).not.toBeInTheDocument();
      });
    });

    it("renders cleanup error banner when purge throws", async () => {
      mockPurgeStaleFloorPlanCache.mockRejectedValueOnce(new Error("Disk error"));

      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-clean-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("storage-meter-clean-btn"));
      fireEvent.click(screen.getByTestId("clean-stale-confirm-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("clean-stale-cache-error")).toHaveTextContent(
          "Unable to clean stale floor plans. Please try again.",
        );
      });
    });
  });

  describe("Error Handling", () => {
    it("displays error banner when fetching stats fails", async () => {
      mockGetCachedFloorPlanStorageStats.mockRejectedValueOnce(new Error("Storage unavailable"));

      render(<OfflineStorageUsageMeter />);

      await waitFor(() => {
        expect(screen.getByTestId("storage-meter-storage-error")).toHaveTextContent(
          "Unable to refresh offline storage usage.",
        );
      });
    });
  });
});
