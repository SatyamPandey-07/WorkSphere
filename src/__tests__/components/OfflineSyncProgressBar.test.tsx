import { render, screen, act } from "@testing-library/react";
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

  it("dismisses toast automatically after completion timeout", async () => {
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
});
