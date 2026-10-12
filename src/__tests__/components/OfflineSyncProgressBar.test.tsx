import { render, screen, act, fireEvent } from "@testing-library/react";
import { OfflineSyncProgressBar } from "../../components/pwa/OfflineSyncProgressBar";

jest.mock("../../lib/offlineStorage", () => ({
  processPendingActions: jest.fn().mockResolvedValue([
    { type: "favorite-add", venueId: "v1" },
    { type: "rating-add", venueId: "v2" },
    { type: "booking-create", venueId: "v3" },
  ]),
}));

describe("OfflineSyncProgressBar Component", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("renders active sync status and remaining item count when pending actions exist", async () => {
    const handleSyncComplete = jest.fn();

    render(
      <OfflineSyncProgressBar
        initialPendingCount={3}
        onSyncComplete={handleSyncComplete}
      />,
    );

    // Verify toast is rendered
    expect(screen.getByTestId("offline-sync-progress-bar")).toBeInTheDocument();
    expect(screen.getByText("Reconnecting & Syncing")).toBeInTheDocument();

    // Advance timer for 1st item sync
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(
      screen.getByText(/Syncing 1 of 3 pending actions/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\(2 remaining\)/i)).toBeInTheDocument();

    // Advance timer for remaining items sync
    act(() => {
      jest.advanceTimersByTime(1200);
    });

    expect(screen.getByText("Sync Completed")).toBeInTheDocument();
    expect(
      screen.getByText("Successfully synced all 3 offline actions"),
    ).toBeInTheDocument();
    expect(handleSyncComplete).toHaveBeenCalledTimes(1);

    // Verify progress fill is 100%
    const progressFill = screen.getByTestId("sync-progress-fill");
    expect(progressFill).toHaveStyle("width: 100%");
  });

  it("dismisses toast automatically after completion timeout when no items fail", async () => {
    render(<OfflineSyncProgressBar initialPendingCount={1} />);

    act(() => {
      jest.advanceTimersByTime(400); // sync completes
    });

    expect(screen.getByText("Sync Completed")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000); // 2s dismiss delay
    });

    expect(
      screen.queryByTestId("offline-sync-progress-bar"),
    ).not.toBeInTheDocument();
  });

  it("bypasses stuck items after 3 failed retries, progresses remaining queue, and displays warning with retry/discard actions", async () => {
    const handleSyncComplete = jest.fn();
    const handleDiscard = jest.fn();

    // Item 1 will fail with 400 Bad Request, Items 2 and 3 will succeed
    const testItems = [
      {
        id: "action-1",
        name: "Create Booking",
        shouldFail: true,
        error: "400 Bad Request",
      },
      { id: "action-2", name: "Add Rating" },
      { id: "action-3", name: "Save Favorite" },
    ];

    render(
      <OfflineSyncProgressBar
        initialItems={testItems}
        onSyncComplete={handleSyncComplete}
        onDiscardItem={handleDiscard}
        maxRetries={3}
      />,
    );

    // 1st retry failure (400ms) - retryCount becomes 1
    act(() => {
      jest.advanceTimersByTime(400);
    });
    // Still retrying item 1, not bypassed yet
    expect(screen.queryByTestId("sync-failed-warning")).not.toBeInTheDocument();

    // 2nd retry failure (800ms) - retryCount becomes 2
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId("sync-failed-warning")).not.toBeInTheDocument();

    // 3rd retry failure (1200ms) - retryCount reaches 3 (maxRetries)
    // Item 1 is bypassed!
    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Warning and alert badge appear for the bypassed item
    expect(screen.getByTestId("sync-failed-warning")).toBeInTheDocument();
    expect(screen.getByTestId("sync-failed-warning")).toHaveTextContent(
      "1 item failed to sync",
    );
    expect(screen.getByTestId("failed-item-badge")).toBeInTheDocument();

    // Next tick (1600ms): Sync progresses to Item 2 and succeeds!
    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Next tick (2000ms): Sync progresses to Item 3 and succeeds!
    act(() => {
      jest.advanceTimersByTime(400);
    });

    // Sync completes!
    expect(handleSyncComplete).toHaveBeenCalledWith({
      successful: 2,
      failed: 1,
    });

    // Complete sync progress bar reaches 100% for all successful items
    const progressFill = screen.getByTestId("sync-progress-fill");
    expect(progressFill).toHaveStyle("width: 100%");
    expect(progressFill).toHaveClass("bg-amber-500");

    // Header displays alert icon and warning status
    expect(screen.getByTestId("sync-alert-icon")).toBeInTheDocument();
    expect(screen.getByText("Sync Warning")).toBeInTheDocument();
    expect(
      screen.getByText(/1 item failed to sync \(2 synced\)/i),
    ).toBeInTheDocument();

    // View button reveals failed item details and retry badge
    const viewButton = screen.getByTestId("view-failed-btn");
    expect(viewButton).toHaveTextContent("View");
    fireEvent.click(viewButton);

    expect(screen.getByTestId("failed-items-details")).toBeInTheDocument();
    expect(screen.getByText("Create Booking")).toBeInTheDocument();
    expect(screen.getByTestId("failed-item-badge-action-1")).toHaveTextContent(
      "3 retries",
    );

    // Discard single item removes it from failed list and calls onDiscardItem
    const singleDiscardBtn = screen.getByTestId("discard-item-action-1");
    fireEvent.click(singleDiscardBtn);

    expect(handleDiscard).toHaveBeenCalledWith("action-1");
    expect(screen.queryByTestId("sync-failed-warning")).not.toBeInTheDocument();
  });

  it("supports batch discard of all failed items", async () => {
    const handleDiscard = jest.fn();

    const testItems = [
      { id: "action-fail-1", name: "Note Edit", shouldFail: true },
      { id: "action-fail-2", name: "Review Post", shouldFail: true },
    ];

    render(
      <OfflineSyncProgressBar
        initialItems={testItems}
        onDiscardItem={handleDiscard}
        maxRetries={1} // Bypass after 1 failure for quick test
      />,
    );

    // Fail both items
    act(() => {
      jest.advanceTimersByTime(800);
    });

    expect(screen.getByTestId("sync-failed-warning")).toHaveTextContent(
      "2 items failed to sync",
    );

    const discardBatchBtn = screen.getByTestId("discard-sync-btn");
    fireEvent.click(discardBatchBtn);

    expect(handleDiscard).toHaveBeenCalledWith("action-fail-1");
    expect(handleDiscard).toHaveBeenCalledWith("action-fail-2");
    expect(screen.queryByTestId("sync-failed-warning")).not.toBeInTheDocument();
  });

  it("supports retry action to re-attempt syncing failed items", async () => {
    const handleRetryFailed = jest.fn();
    let attempt = 0;

    const mockSyncItem = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt <= 1) {
        throw new Error("Validation failure");
      }
      return Promise.resolve(true);
    });

    render(
      <OfflineSyncProgressBar
        initialItems={[{ id: "item-retry", name: "Amenity Vote" }]}
        onSyncItem={mockSyncItem}
        onRetryFailed={handleRetryFailed}
        maxRetries={1}
      />,
    );

    // Initial attempt fails and is bypassed
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(screen.getByTestId("sync-failed-warning")).toHaveTextContent(
      "1 item failed to sync",
    );

    // Click Retry
    const retryBtn = screen.getByTestId("retry-sync-btn");
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(handleRetryFailed).toHaveBeenCalledTimes(1);

    // Second sync attempt succeeds
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(screen.getByText("Sync Completed")).toBeInTheDocument();
    expect(screen.queryByTestId("sync-failed-warning")).not.toBeInTheDocument();
  });
});
