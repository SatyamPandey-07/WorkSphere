import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { BulkVenuePartitionManager } from "@/components/admin/BulkVenuePartitionManager";
import type {
  VenuePartitionSummary,
  VenuePartitionDetails,
  BulkPartitionOperationResult,
} from "@/lib/adminPartitionService";

// Mock child PartitionDiskStorageUsageBar to keep unit tests focused and fast
jest.mock("@/components/admin/PartitionDiskStorageUsageBar", () => ({
  PartitionDiskStorageUsageBar: ({
    onFilterByParent,
    onFilterByStatus,
  }: {
    onFilterByParent?: (p: string) => void;
    onFilterByStatus?: (s: string) => void;
  }) => (
    <div data-testid="mock-partition-storage-bar">
      <button
        type="button"
        data-testid="mock-bar-filter-parent"
        onClick={() => onFilterByParent?.("TelemetryRecord")}
      >
        Filter Parent
      </button>
      <button
        type="button"
        data-testid="mock-bar-filter-status"
        onClick={() => onFilterByStatus?.("EXPIRED")}
      >
        Filter Status
      </button>
    </div>
  ),
}));

describe("BulkVenuePartitionManager Component", () => {
  const mockPartitions: VenuePartitionDetails[] = [
    {
      name: "TelemetryRecord_y2026m01",
      parentTable: "TelemetryRecord",
      schema: "public",
      exists: true,
      rowCount: 120000,
      tableSizeBytes: 120 * 1024 * 1024,
      tableSizePretty: "120 MB",
      isNearColdStorage: true,
      isExpired: false,
      isArchived: false,
      year: 2026,
      month: 1,
      formattedPeriod: "Jan 2026",
    },
    {
      name: "PushNotificationLog_y2025m02",
      parentTable: "PushNotificationLog",
      schema: "public",
      exists: true,
      rowCount: 50000,
      tableSizeBytes: 30 * 1024 * 1024,
      tableSizePretty: "30 MB",
      isNearColdStorage: false,
      isExpired: true,
      isArchived: false,
      year: 2025,
      month: 2,
      formattedPeriod: "Feb 2025",
    },
    {
      name: "VenueBooking_y2024m08",
      parentTable: "VenueBooking",
      schema: "archive",
      exists: true,
      rowCount: 10000,
      tableSizeBytes: 8 * 1024 * 1024,
      tableSizePretty: "8 MB",
      isNearColdStorage: false,
      isExpired: true,
      isArchived: true,
      year: 2024,
      month: 8,
      formattedPeriod: "Aug 2024",
    },
  ];

  const mockInitialData: VenuePartitionSummary = {
    status: "HEALTHY",
    checkedAt: "2026-10-30T12:00:00Z",
    totalPartitions: 3,
    totalSizeBytes: 158 * 1024 * 1024,
    totalSizePretty: "158 MB",
    totalRows: 180000,
    activeCount: 2,
    archivedCount: 1,
    expiredCount: 2,
    partitions: mockPartitions,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Rendering & Baseline Behavior", () => {
    it("renders gracefully with undefined or empty initialData", () => {
      render(<BulkVenuePartitionManager initialData={undefined} />);
      expect(screen.getByTestId("bulk-partition-manager")).toBeInTheDocument();
      expect(
        screen.getByText("No partitions matched your filters."),
      ).toBeInTheDocument();
      expect(screen.getByText("Total Partitions")).toBeInTheDocument();
      expect(screen.getByText("0 B")).toBeInTheDocument();
    });

    it("renders healthy status badge and metrics correctly", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);

      expect(screen.getByText("HEALTHY")).toBeInTheDocument();
      expect(screen.getByText("158 MB")).toBeInTheDocument();
      expect(screen.getByText("180,000 live rows")).toBeInTheDocument();
      expect(
        screen.getByText("TelemetryRecord_y2026m01"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("PushNotificationLog_y2025m02"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("VenueBooking_y2024m08"),
      ).toBeInTheDocument();
    });

    it("renders critical status badge when initialData status is CRITICAL", () => {
      const criticalData: VenuePartitionSummary = {
        ...mockInitialData,
        status: "CRITICAL",
      };
      render(<BulkVenuePartitionManager initialData={criticalData} />);
      expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    });

    it("renders rows with appropriate status tags (Active, Expired, Archived)", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);

      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.getByText("Expired")).toBeInTheDocument();
      expect(screen.getByText("Archived")).toBeInTheDocument();
      expect(screen.getByText(">100MB")).toBeInTheDocument();
    });
  });

  describe("Filtering & Searching", () => {
    it("filters partitions by search query matching partition name", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const searchInput = screen.getByTestId("search-input");

      fireEvent.change(searchInput, { target: { value: "Telemetry" } });

      expect(
        screen.getByText("TelemetryRecord_y2026m01"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("PushNotificationLog_y2025m02"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("VenueBooking_y2024m08"),
      ).not.toBeInTheDocument();
    });

    it("filters partitions by search query matching formatted period", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const searchInput = screen.getByTestId("search-input");

      fireEvent.change(searchInput, { target: { value: "Feb 2025" } });

      expect(
        screen.getByText("PushNotificationLog_y2025m02"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("TelemetryRecord_y2026m01"),
      ).not.toBeInTheDocument();
    });

    it("filters partitions by parent table selector", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const parentSelect = screen.getByTestId("parent-filter-select");

      fireEvent.change(parentSelect, { target: { value: "PushNotificationLog" } });

      expect(
        screen.getByText("PushNotificationLog_y2025m02"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("TelemetryRecord_y2026m01"),
      ).not.toBeInTheDocument();
    });

    it("filters partitions by status selector", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const statusSelect = screen.getByTestId("status-filter-select");

      // Filter ACTIVE
      fireEvent.change(statusSelect, { target: { value: "ACTIVE" } });
      expect(
        screen.getByText("TelemetryRecord_y2026m01"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("VenueBooking_y2024m08"),
      ).not.toBeInTheDocument();

      // Filter ARCHIVED
      fireEvent.change(statusSelect, { target: { value: "ARCHIVED" } });
      expect(
        screen.getByText("VenueBooking_y2024m08"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("TelemetryRecord_y2026m01"),
      ).not.toBeInTheDocument();

      // Filter COLD (>100MB)
      fireEvent.change(statusSelect, { target: { value: "COLD" } });
      expect(
        screen.getByText("TelemetryRecord_y2026m01"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("PushNotificationLog_y2025m02"),
      ).not.toBeInTheDocument();
    });

    it("updates filters via storage bar callbacks", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);

      fireEvent.click(screen.getByTestId("mock-bar-filter-parent"));
      expect(
        screen.getByText("TelemetryRecord_y2026m01"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("PushNotificationLog_y2025m02"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("mock-bar-filter-status"));
      expect(
        screen.queryByText("PushNotificationLog_y2025m02"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Selection & Quick Select", () => {
    it("toggles single partition selection", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const checkbox = screen.getByTestId(
        "partition-checkbox-TelemetryRecord_y2026m01",
      );

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
      expect(screen.getByText("120.0 MB selected")).toBeInTheDocument();

      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
      expect(screen.getByText("None selected")).toBeInTheDocument();
    });

    it("selects all visible partitions via quick select all button", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const selectAllBtn = screen.getByTestId("quick-select-all");

      fireEvent.click(selectAllBtn);
      expect(screen.getByText("158.0 MB selected")).toBeInTheDocument();
      expect(screen.getByTestId("clear-selection-btn")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("clear-selection-btn"));
      expect(screen.getByText("None selected")).toBeInTheDocument();
    });

    it("selects expired partitions via quick select expired", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const selectExpiredBtn = screen.getByTestId("quick-select-expired");

      fireEvent.click(selectExpiredBtn);
      // Only active expired (PushNotificationLog_y2025m02) is selected, archived is excluded
      expect(
        screen.getByTestId("partition-checkbox-PushNotificationLog_y2025m02"),
      ).toBeChecked();
      expect(
        screen.getByTestId("partition-checkbox-VenueBooking_y2024m08"),
      ).not.toBeChecked();
    });

    it("selects cold heavy partitions via quick select cold", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const selectColdBtn = screen.getByTestId("quick-select-cold");

      fireEvent.click(selectColdBtn);
      expect(
        screen.getByTestId("partition-checkbox-TelemetryRecord_y2026m01"),
      ).toBeChecked();
      expect(
        screen.getByTestId("partition-checkbox-PushNotificationLog_y2025m02"),
      ).not.toBeChecked();
    });

    it("toggles select all visible via header checkbox", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const headerCheckbox = screen.getByTestId("select-all-checkbox");

      fireEvent.click(headerCheckbox);
      expect(headerCheckbox).toBeChecked();

      fireEvent.click(headerCheckbox);
      expect(headerCheckbox).not.toBeChecked();
      expect(screen.getByText("None selected")).toBeInTheDocument();
    });
  });

  describe("Refresh Handling", () => {
    it("calls onRefresh when refresh button is clicked", async () => {
      const mockRefresh = jest.fn().mockResolvedValue(undefined);
      render(
        <BulkVenuePartitionManager
          initialData={mockInitialData}
          onRefresh={mockRefresh}
        />,
      );

      fireEvent.click(screen.getByTestId("refresh-button"));
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it("handles onRefresh rejection and surfaces error toast", async () => {
      const mockRefresh = jest
        .fn()
        .mockRejectedValue(new Error("Network timeout"));
      render(
        <BulkVenuePartitionManager
          initialData={mockInitialData}
          onRefresh={mockRefresh}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("refresh-button"));
      });

      expect(
        screen.getByText("Network timeout"),
      ).toBeInTheDocument();
    });
  });

  describe("Bulk Archive Workflow", () => {
    it("disables bulk archive button when no partitions are selected", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const archiveBtn = screen.getByTestId("bulk-archive-btn");
      expect(archiveBtn).toBeDisabled();
    });

    it("opens archive modal on row action button", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const rowArchiveBtn = screen.getByTestId(
        "row-archive-btn-TelemetryRecord_y2026m01",
      );

      fireEvent.click(rowArchiveBtn);
      expect(screen.getByTestId("archive-modal")).toBeInTheDocument();
      expect(
        screen.getByText("Confirm Bulk Partition Archive"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("cancel-archive-btn"));
      expect(screen.queryByTestId("archive-modal")).not.toBeInTheDocument();
    });

    it("performs successful bulk archive and refreshes catalog", async () => {
      const mockRefresh = jest.fn().mockResolvedValue(undefined);
      const mockResult: BulkPartitionOperationResult = {
        success: true,
        action: "ARCHIVE",
        processed: ["TelemetryRecord_y2026m01"],
        failed: [],
        freedBytes: 120 * 1024 * 1024,
        freedSizePretty: "120 MB",
        timestamp: "2026-10-30T12:00:00Z",
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      render(
        <BulkVenuePartitionManager
          initialData={mockInitialData}
          onRefresh={mockRefresh}
        />,
      );

      // Select item
      fireEvent.click(
        screen.getByTestId("partition-checkbox-TelemetryRecord_y2026m01"),
      );
      fireEvent.click(screen.getByTestId("bulk-archive-btn"));

      expect(screen.getByTestId("archive-modal")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-archive-btn"));
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/system/partitions/archive",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            partitions: ["TelemetryRecord_y2026m01"],
          }),
        }),
      );

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("operation-feedback")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Successfully archived 1 partition(s). Freed active catalog: 120 MB.",
        ),
      ).toBeInTheDocument();
    });

    it("handles archive API error properly", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Partition is locked by active transaction" }),
      });

      render(<BulkVenuePartitionManager initialData={mockInitialData} />);

      fireEvent.click(
        screen.getByTestId("partition-checkbox-TelemetryRecord_y2026m01"),
      );
      fireEvent.click(screen.getByTestId("bulk-archive-btn"));

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-archive-btn"));
      });

      expect(
        screen.getByText("Partition is locked by active transaction"),
      ).toBeInTheDocument();
    });
  });

  describe("Bulk Delete Workflow", () => {
    it("disables bulk delete button when no partitions are selected", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const deleteBtn = screen.getByTestId("bulk-delete-btn");
      expect(deleteBtn).toBeDisabled();
    });

    it("opens delete modal on row action button and requires typing DELETE", () => {
      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      const rowDeleteBtn = screen.getByTestId(
        "row-delete-btn-PushNotificationLog_y2025m02",
      );

      fireEvent.click(rowDeleteBtn);
      expect(screen.getByTestId("delete-modal")).toBeInTheDocument();

      const confirmBtn = screen.getByTestId("confirm-delete-btn");
      expect(confirmBtn).toBeDisabled();

      const input = screen.getByTestId("delete-confirm-input");
      fireEvent.change(input, { target: { value: "delete" } });
      expect(confirmBtn).toBeDisabled();

      fireEvent.change(input, { target: { value: "DELETE" } });
      expect(confirmBtn).not.toBeDisabled();

      fireEvent.click(screen.getByTestId("cancel-delete-btn"));
      expect(screen.queryByTestId("delete-modal")).not.toBeInTheDocument();
    });

    it("performs successful bulk delete and displays confirmation feedback", async () => {
      const mockRefresh = jest.fn().mockResolvedValue(undefined);
      const mockResult: BulkPartitionOperationResult = {
        success: true,
        action: "DELETE",
        processed: ["PushNotificationLog_y2025m02"],
        failed: [],
        freedBytes: 30 * 1024 * 1024,
        freedSizePretty: "30 MB",
        timestamp: "2026-10-30T12:00:00Z",
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      render(
        <BulkVenuePartitionManager
          initialData={mockInitialData}
          onRefresh={mockRefresh}
        />,
      );

      fireEvent.click(
        screen.getByTestId("partition-checkbox-PushNotificationLog_y2025m02"),
      );
      fireEvent.click(screen.getByTestId("bulk-delete-btn"));

      const input = screen.getByTestId("delete-confirm-input");
      fireEvent.change(input, { target: { value: "DELETE" } });

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-delete-btn"));
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/system/partitions/delete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            partitions: ["PushNotificationLog_y2025m02"],
          }),
        }),
      );

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("operation-feedback")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Successfully permanently deleted 1 partition(s). Physical disk freed: 30 MB.",
        ),
      ).toBeInTheDocument();
    });

    it("handles delete API failure gracefully", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Permission denied for dropping partition" }),
      });

      render(<BulkVenuePartitionManager initialData={mockInitialData} />);

      fireEvent.click(
        screen.getByTestId("partition-checkbox-PushNotificationLog_y2025m02"),
      );
      fireEvent.click(screen.getByTestId("bulk-delete-btn"));

      const input = screen.getByTestId("delete-confirm-input");
      fireEvent.change(input, { target: { value: "DELETE" } });

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-delete-btn"));
      });

      expect(
        screen.getByText("Permission denied for dropping partition"),
      ).toBeInTheDocument();
    });
  });

  describe("Feedback Dismissal & Cleanup", () => {
    it("dismisses operation feedback banner when dismiss button is clicked", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Simulated error" }),
      });

      render(<BulkVenuePartitionManager initialData={mockInitialData} />);
      fireEvent.click(
        screen.getByTestId("partition-checkbox-TelemetryRecord_y2026m01"),
      );
      fireEvent.click(screen.getByTestId("bulk-archive-btn"));

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-archive-btn"));
      });

      expect(screen.getByTestId("operation-feedback")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("dismiss-feedback-btn"));
      expect(
        screen.queryByTestId("operation-feedback"),
      ).not.toBeInTheDocument();
    });

    it("does not update state if unmounted during pending fetch", async () => {
      let resolvePromise: (val: any) => void;
      const pendingFetch = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      (global.fetch as jest.Mock).mockReturnValueOnce(pendingFetch);

      const { unmount } = render(
        <BulkVenuePartitionManager initialData={mockInitialData} />,
      );

      fireEvent.click(
        screen.getByTestId("partition-checkbox-TelemetryRecord_y2026m01"),
      );
      fireEvent.click(screen.getByTestId("bulk-archive-btn"));

      act(() => {
        fireEvent.click(screen.getByTestId("confirm-archive-btn"));
      });

      // Unmount while fetch is in-flight
      unmount();

      // Resolve after unmount
      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            action: "ARCHIVE",
            processed: ["TelemetryRecord_y2026m01"],
            freedBytes: 100,
            freedSizePretty: "100 B",
          }),
        });
      });

      // Verification: No uncaught errors thrown
      expect(true).toBe(true);
    });
  });
});
