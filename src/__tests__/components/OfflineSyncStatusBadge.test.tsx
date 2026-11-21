import { render, screen } from "@testing-library/react";
import { OfflineSyncStatusBadge } from "@/components/sync/OfflineSyncStatusBadge";
import { useOfflineSyncStatus } from "@/hooks/useOfflineSyncStatus";

jest.mock("@/hooks/useOfflineSyncStatus", () => ({
  useOfflineSyncStatus: jest.fn(),
}));

const mockUseOfflineSyncStatus = useOfflineSyncStatus as jest.Mock;

describe("OfflineSyncStatusBadge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the pending count while offline", () => {
    mockUseOfflineSyncStatus.mockReturnValue({
      isOffline: true,
      isSyncing: false,
      pendingCount: 4,
      refreshPendingCount: jest.fn(),
    });

    render(<OfflineSyncStatusBadge />);

    const badge = screen.getByTestId("offline-sync-status-badge");
    expect(badge).toHaveTextContent("Pending 4");
    expect(badge).toHaveAttribute("aria-label", "4 changes waiting for connection");
    expect(badge.className).toContain("bg-amber-50");
  });

  it("changes to the active syncing style while the outbox is flushing", () => {
    mockUseOfflineSyncStatus.mockReturnValue({
      isOffline: false,
      isSyncing: true,
      pendingCount: 2,
      refreshPendingCount: jest.fn(),
    });

    render(<OfflineSyncStatusBadge />);

    const badge = screen.getByTestId("offline-sync-status-badge");
    expect(badge).toHaveTextContent("Syncing 2");
    expect(badge).toHaveAttribute("data-syncing", "true");
    expect(badge.className).toContain("bg-blue-50");
  });

  it("hides when there are no pending mutations", () => {
    mockUseOfflineSyncStatus.mockReturnValue({
      isOffline: false,
      isSyncing: false,
      pendingCount: 0,
      refreshPendingCount: jest.fn(),
    });

    const { container } = render(<OfflineSyncStatusBadge />);
    expect(container.firstChild).toBeNull();
  });
});
