import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PartitionDiskStorageUsageBar } from "@/components/admin/PartitionDiskStorageUsageBar";
import type { VenuePartitionDetails } from "@/lib/adminPartitionService";

describe("PartitionDiskStorageUsageBar zero capacity guard (#6067)", () => {
  const dummyZeroPartitions: VenuePartitionDetails[] = [
    {
      name: "venue_events_2026_10",
      parentTable: "venue_events",
      partitionKey: "2026_10",
      isAttached: true,
      rowCount: 0,
      tableSizeBytes: 0,
      tableSizePretty: "0 B",
      indexesSizeBytes: 0,
      totalSizeBytes: 0,
      isArchived: false,
      isExpired: false,
      isNearColdStorage: false,
    },
  ];

  it("handles totalSizeBytes=0 gracefully without NaN in percentage or width", () => {
    render(
      <PartitionDiskStorageUsageBar
        partitions={dummyZeroPartitions}
        totalSizeBytes={0}
      />
    );

    expect(screen.getByTestId("partition-storage-usage-bar")).toBeInTheDocument();
    expect(screen.getByTestId("storage-zero-capacity-badge")).toHaveTextContent("No storage data recorded");
    expect(screen.getByTestId("storage-empty-fill")).toHaveStyle({ width: "0%" });
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
  });

  it("handles missing/undefined partition bytes without throwing NaN", () => {
    const uncalculatedPartitions: any[] = [
      {
        name: "venue_metrics_2026",
        parentTable: "venue_metrics",
        partitionKey: "2026",
        isAttached: true,
        rowCount: undefined,
        tableSizeBytes: undefined,
        isArchived: false,
      },
    ];

    render(
      <PartitionDiskStorageUsageBar
        partitions={uncalculatedPartitions}
      />
    );

    expect(screen.getByTestId("partition-storage-usage-bar")).toBeInTheDocument();
    expect(screen.getByTestId("storage-zero-capacity-badge")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
  });

  it("clamps percentage values strictly between 0% and 100%", () => {
    const validPartitions: VenuePartitionDetails[] = [
      {
        name: "venue_reviews_2026_09",
        parentTable: "venue_reviews",
        partitionKey: "2026_09",
        isAttached: true,
        rowCount: 100,
        tableSizeBytes: 500,
        tableSizePretty: "500 B",
        indexesSizeBytes: 0,
        totalSizeBytes: 500,
        isArchived: false,
        isExpired: false,
        isNearColdStorage: false,
      },
    ];

    render(
      <PartitionDiskStorageUsageBar
        partitions={validPartitions}
        totalSizeBytes={1000}
      />
    );

    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
  });
});
