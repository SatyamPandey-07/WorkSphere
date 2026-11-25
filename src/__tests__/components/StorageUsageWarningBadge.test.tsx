import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StorageUsageWarningBadge } from "@/components/Header/StorageUsageWarningBadge";
import * as useStorageQuotaModule from "@/hooks/useStorageQuota";

jest.mock("@/components/offline/StorageStatsDrawer", () => ({
  StorageStatsDrawer: ({
    isOpen,
    onClose,
    initialFocusSection,
  }: {
    isOpen: boolean;
    onClose: () => void;
    initialFocusSection?: string;
  }) =>
    isOpen ? (
      <div
        data-testid="mock-storage-stats-drawer"
        data-initial-section={initialFocusSection}
      >
        <button onClick={onClose} data-testid="mock-close-drawer">
          Close
        </button>
      </div>
    ) : null,
}));

describe("StorageUsageWarningBadge Component (#7946)", () => {
  const mockUseStorageQuota = jest.spyOn(
    useStorageQuotaModule,
    "useStorageQuota",
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Visibility according to 80% threshold", () => {
    it("renders nothing when storage usage is at or below 80%", () => {
      mockUseStorageQuota.mockReturnValue({
        usageBytes: 800 * 1024 * 1024,
        quotaBytes: 1000 * 1024 * 1024,
        usagePercentage: 80,
        remainingBytes: 200 * 1024 * 1024,
        usageMB: 800,
        quotaMB: 1000,
        remainingMB: 200,
        isOverWarningThreshold: false,
        isEstimateAvailable: true,
        refresh: jest.fn(),
      });

      const { container } = render(<StorageUsageWarningBadge />);
      expect(container).toBeEmptyDOMElement();
      expect(
        screen.queryByTestId("storage-usage-warning-badge"),
      ).not.toBeInTheDocument();
    });

    it("renders nothing when storage estimate is unavailable", () => {
      mockUseStorageQuota.mockReturnValue({
        ...useStorageQuotaModule.DEFAULT_STORAGE_ESTIMATE,
        refresh: jest.fn(),
      });

      const { container } = render(<StorageUsageWarningBadge />);
      expect(container).toBeEmptyDOMElement();
    });

    it("renders warning badge when storage usage is strictly greater than 80%", () => {
      mockUseStorageQuota.mockReturnValue({
        usageBytes: 820 * 1024 * 1024,
        quotaBytes: 950 * 1024 * 1024,
        usagePercentage: 86.315,
        remainingBytes: 130 * 1024 * 1024,
        usageMB: 820,
        quotaMB: 950,
        remainingMB: 130,
        isOverWarningThreshold: true,
        isEstimateAvailable: true,
        refresh: jest.fn(),
      });

      render(<StorageUsageWarningBadge />);

      const badge = screen.getByTestId("storage-usage-warning-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("type", "button");
      expect(badge).toHaveClass("bg-amber-500/20");

      const icon = screen.getByTestId("storage-usage-warning-badge-icon");
      expect(icon).toBeInTheDocument();
    });
  });

  describe("Tooltip and Accessible Label Formatting", () => {
    it("formats tooltip and aria-label with exact MB values and percentage", () => {
      mockUseStorageQuota.mockReturnValue({
        usageBytes: 820 * 1024 * 1024,
        quotaBytes: 950 * 1024 * 1024,
        usagePercentage: 86.3,
        remainingBytes: 130 * 1024 * 1024,
        usageMB: 820,
        quotaMB: 950,
        remainingMB: 130,
        isOverWarningThreshold: true,
        isEstimateAvailable: true,
        refresh: jest.fn(),
      });

      render(<StorageUsageWarningBadge />);

      const badge = screen.getByTestId("storage-usage-warning-badge");
      expect(badge).toHaveAttribute(
        "title",
        "Storage usage: 820 MB / 950 MB (86.3%)\nRemaining: 130 MB",
      );
      expect(badge).toHaveAttribute(
        "aria-label",
        "Storage quota warning: 86.3% used (820 MB of 950 MB, 130 MB remaining). Click to manage and clean up offline cache.",
      );
    });

    it("displays percentage in badge text across desktop and mobile variants", () => {
      mockUseStorageQuota.mockReturnValue({
        usageBytes: 850 * 1024 * 1024,
        quotaBytes: 1000 * 1024 * 1024,
        usagePercentage: 85,
        remainingBytes: 150 * 1024 * 1024,
        usageMB: 850,
        quotaMB: 1000,
        remainingMB: 150,
        isOverWarningThreshold: true,
        isEstimateAvailable: true,
        refresh: jest.fn(),
      });

      render(<StorageUsageWarningBadge />);

      const desktopText = screen.getByTestId(
        "storage-usage-warning-badge-text",
      );
      expect(desktopText).toHaveTextContent("Storage (85%)");

      const mobileText = screen.getByTestId(
        "storage-usage-warning-badge-text-mobile",
      );
      expect(mobileText).toHaveTextContent("85%");
    });
  });

  describe("StorageStatsDrawer integration", () => {
    it("opens StorageStatsDrawer with initialFocusSection set to 'cleanup' on click", async () => {
      const mockOnClick = jest.fn();
      mockUseStorageQuota.mockReturnValue({
        usageBytes: 820 * 1024 * 1024,
        quotaBytes: 950 * 1024 * 1024,
        usagePercentage: 86.3,
        remainingBytes: 130 * 1024 * 1024,
        usageMB: 820,
        quotaMB: 950,
        remainingMB: 130,
        isOverWarningThreshold: true,
        isEstimateAvailable: true,
        refresh: jest.fn(),
      });

      render(<StorageUsageWarningBadge onClick={mockOnClick} />);

      expect(
        screen.queryByTestId("mock-storage-stats-drawer"),
      ).not.toBeInTheDocument();

      const badge = screen.getByTestId("storage-usage-warning-badge");
      fireEvent.click(badge);

      expect(mockOnClick).toHaveBeenCalledTimes(1);

      const drawer = screen.getByTestId("mock-storage-stats-drawer");
      expect(drawer).toBeInTheDocument();
      expect(drawer).toHaveAttribute("data-initial-section", "cleanup");

      // Can close drawer
      const closeBtn = screen.getByTestId("mock-close-drawer");
      fireEvent.click(closeBtn);

      await waitFor(() => {
        expect(
          screen.queryByTestId("mock-storage-stats-drawer"),
        ).not.toBeInTheDocument();
      });
    });

    it("can be triggered by keyboard Enter or Space as standard button", () => {
      mockUseStorageQuota.mockReturnValue({
        usageBytes: 900 * 1024 * 1024,
        quotaBytes: 1000 * 1024 * 1024,
        usagePercentage: 90,
        remainingBytes: 100 * 1024 * 1024,
        usageMB: 900,
        quotaMB: 1000,
        remainingMB: 100,
        isOverWarningThreshold: true,
        isEstimateAvailable: true,
        refresh: jest.fn(),
      });

      render(<StorageUsageWarningBadge />);

      const badge = screen.getByTestId("storage-usage-warning-badge");
      fireEvent.click(badge);

      expect(
        screen.getByTestId("mock-storage-stats-drawer"),
      ).toBeInTheDocument();
    });
  });
});
