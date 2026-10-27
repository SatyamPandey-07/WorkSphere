import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PartitionDiskStorageUsageBar,
  formatBytes,
  safePercent,
} from "@/components/admin/PartitionDiskStorageUsageBar";
import type { VenuePartitionDetails } from "@/lib/adminPartitionService";

describe("PartitionDiskStorageUsageBar & Utilities", () => {
  describe("formatBytes utility", () => {
    it("returns '0 B' for zero, negative, and non-finite inputs", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(-1024)).toBe("0 B");
      expect(formatBytes(NaN)).toBe("0 B");
      expect(formatBytes(Infinity)).toBe("0 B");
      expect(formatBytes(-Infinity)).toBe("0 B");
    });

    it("formats standard byte sizes correctly across B, KB, MB, GB, TB", () => {
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
      expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
      expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2 GB");
      expect(formatBytes(500 * Math.pow(1024, 4))).toBe("500 TB");
    });

    it("formats petabyte and exabyte scale values without dropping to '0 B'", () => {
      const onePetabyte = Math.pow(1024, 5);
      expect(formatBytes(onePetabyte)).toBe("1 PB");
      expect(formatBytes(2.5 * onePetabyte)).toBe("2.5 PB");
      const oneExabyte = Math.pow(1024, 6);
      expect(formatBytes(oneExabyte)).toBe("1 EB");
    });
  });

  describe("safePercent utility", () => {
    it("returns 0 for invalid, zero, or non-finite inputs", () => {
      expect(safePercent(0, 1000)).toBe(0);
      expect(safePercent(500, 0)).toBe(0);
      expect(safePercent(-100, 1000)).toBe(0);
      expect(safePercent(100, -1000)).toBe(0);
      expect(safePercent(NaN, 1000)).toBe(0);
      expect(safePercent(500, NaN)).toBe(0);
      expect(safePercent(Infinity, 1000)).toBe(0);
      expect(safePercent(500, Infinity)).toBe(0);
    });

    it("calculates exact percentage and clamps between 0 and 100", () => {
      expect(safePercent(250, 1000)).toBe(25);
      expect(safePercent(500, 1000)).toBe(50);
      expect(safePercent(1000, 1000)).toBe(100);
      expect(safePercent(1500, 1000)).toBe(100);
    });
  });

  describe("PartitionDiskStorageUsageBar Component", () => {
    const mockPartitions: VenuePartitionDetails[] = [
      {
        name: "TelemetryRecord_y2026m01",
        parentTable: "TelemetryRecord",
        schema: "public",
        exists: true,
        rowCount: 150000,
        tableSizeBytes: 120 * 1024 * 1024, // 120 MB (Heavy)
        tableSizePretty: "120 MB",
        isNearColdStorage: true,
        isExpired: false,
        isArchived: false,
      },
      {
        name: "PushNotificationLog_y2025m10",
        parentTable: "PushNotificationLog",
        schema: "public",
        exists: true,
        rowCount: 45000,
        tableSizeBytes: 30 * 1024 * 1024, // 30 MB
        tableSizePretty: "30 MB",
        isNearColdStorage: false,
        isExpired: true,
        isArchived: false,
      },
      {
        name: "VenueBooking_y2024m05",
        parentTable: "VenueBooking",
        schema: "public",
        exists: true,
        rowCount: 10000,
        tableSizeBytes: 10 * 1024 * 1024, // 10 MB
        tableSizePretty: "10 MB",
        isNearColdStorage: false,
        isExpired: false,
        isArchived: true,
      },
    ];

    it("renders nothing when partitions array is empty", () => {
      const { container } = render(<PartitionDiskStorageUsageBar partitions={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("displays zero capacity badge and empty state when storage is zero", () => {
      const zeroPartitions: VenuePartitionDetails[] = [
        {
          name: "TelemetryRecord_empty",
          parentTable: "TelemetryRecord",
          schema: "public",
          exists: true,
          rowCount: 0,
          tableSizeBytes: 0,
          tableSizePretty: "0 B",
          isNearColdStorage: false,
          isExpired: false,
          isArchived: false,
        },
      ];

      render(<PartitionDiskStorageUsageBar partitions={zeroPartitions} />);

      expect(screen.getByTestId("storage-zero-capacity-badge")).toBeInTheDocument();
      expect(screen.getByTestId("storage-empty-fill")).toBeInTheDocument();
      expect(
        screen.getByText(/Total disk storage capacity is 0 B or pending initialization/i),
      ).toBeInTheDocument();
    });

    it("renders parent table breakdown and handles segment click and keyboard interaction", () => {
      const onFilterByParent = jest.fn();
      render(
        <PartitionDiskStorageUsageBar
          partitions={mockPartitions}
          onFilterByParent={onFilterByParent}
        />,
      );

      expect(screen.getByTestId("partition-storage-usage-bar")).toBeInTheDocument();
      expect(screen.getByText(/Partition Disk Storage Usage/i)).toBeInTheDocument();
      expect(screen.getByText(/160 MB across 3 partitions/i)).toBeInTheDocument();

      // Check segments exist
      const telemetrySegment = screen.getByTestId("progress-segment-TelemetryRecord");
      expect(telemetrySegment).toBeInTheDocument();

      // Click segment
      fireEvent.click(telemetrySegment);
      expect(onFilterByParent).toHaveBeenCalledWith("TelemetryRecord");

      // Press Enter key on legend item
      const pushLegendItem = screen.getByTestId("legend-item-PushNotificationLog");
      fireEvent.keyDown(pushLegendItem, { key: "Enter" });
      expect(onFilterByParent).toHaveBeenCalledWith("PushNotificationLog");
    });

    it("switches to tier view mode and triggers status filter", () => {
      const onFilterByStatus = jest.fn();
      render(
        <PartitionDiskStorageUsageBar
          partitions={mockPartitions}
          onFilterByStatus={onFilterByStatus}
        />,
      );

      // Switch to 'By Tier' mode
      const tierButton = screen.getByRole("button", { name: /By Tier/i });
      fireEvent.click(tierButton);

      // Verify tier items appear
      expect(screen.getByTestId("progress-segment-ACTIVE")).toBeInTheDocument();
      expect(screen.getByTestId("progress-segment-EXPIRED")).toBeInTheDocument();
      expect(screen.getByTestId("progress-segment-ARCHIVED")).toBeInTheDocument();

      // Click expired tier segment
      fireEvent.click(screen.getByTestId("progress-segment-EXPIRED"));
      expect(onFilterByStatus).toHaveBeenCalledWith("EXPIRED");

      // Space key on archived legend item
      fireEvent.keyDown(screen.getByTestId("legend-item-ARCHIVED"), { key: " " });
      expect(onFilterByStatus).toHaveBeenCalledWith("ARCHIVED");
    });

    it("displays heavy partition count alert when near cold storage or >100MB", () => {
      render(<PartitionDiskStorageUsageBar partitions={mockPartitions} />);

      expect(
        screen.getByText(/1 heavy partition\(s\) >100 MB/i),
      ).toBeInTheDocument();
    });

    it("safely ignores null or sparse entries in partitions array", () => {
      const sparsePartitions = [
        ...mockPartitions,
        null as unknown as VenuePartitionDetails,
        undefined as unknown as VenuePartitionDetails,
      ];

      render(<PartitionDiskStorageUsageBar partitions={sparsePartitions} />);

      // Should still compute valid 160 MB across valid items without crashing or 'unknown' table
      expect(screen.getByTestId("progress-segment-TelemetryRecord")).toBeInTheDocument();
      expect(screen.queryByTestId("progress-segment-unknown")).toBeNull();
    });
  });
});
