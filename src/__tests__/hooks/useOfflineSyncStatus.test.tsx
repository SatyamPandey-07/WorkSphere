import { act, renderHook, waitFor } from "@testing-library/react";
import {
  getTotalPendingMutationsCount,
} from "@/lib/offlineStorage";
import { getQueuedReviews } from "@/lib/offlineReviewSync";
import { useOfflineSyncStatus } from "@/hooks/useOfflineSyncStatus";

jest.mock("@/lib/offlineStorage", () => ({
  getTotalPendingMutationsCount: jest.fn(),
}));

jest.mock("@/lib/offlineReviewSync", () => ({
  getQueuedReviews: jest.fn(),
}));

const mockGetTotalPending = getTotalPendingMutationsCount as jest.MockedFunction<
  typeof getTotalPendingMutationsCount
>;
const mockGetQueuedReviews = getQueuedReviews as jest.MockedFunction<
  typeof getQueuedReviews
>;

describe("useOfflineSyncStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    mockGetTotalPending.mockResolvedValue(2);
    mockGetQueuedReviews.mockResolvedValue([
      { id: "review-1" } as unknown as Awaited<ReturnType<typeof getQueuedReviews>>[number],
    ]);
  });

  it("aggregates pending IndexedDB mutations and queued reviews", async () => {
    const { result } = renderHook(() => useOfflineSyncStatus());

    await waitFor(() => {
      expect(result.current.pendingCount).toBe(3);
    });
    expect(result.current.isOffline).toBe(false);
  });

  it("tracks offline and online transitions and requests a batch sync on reconnect", async () => {
    const wakeSyncWorker = jest.fn();
    window.addEventListener("trigger-sync", wakeSyncWorker);

    const { result, unmount } = renderHook(() => useOfflineSyncStatus());

    await waitFor(() => expect(result.current.pendingCount).toBe(3));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.isOffline).toBe(true);
    expect(result.current.isSyncing).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOffline).toBe(false);
    expect(result.current.isSyncing).toBe(true);
    expect(wakeSyncWorker).toHaveBeenCalledTimes(1);

    unmount();
    window.removeEventListener("trigger-sync", wakeSyncWorker);
  });

  it("refreshes the badge count when review sync events arrive", async () => {
    const { result } = renderHook(() => useOfflineSyncStatus());

    await waitFor(() => expect(result.current.pendingCount).toBe(3));

    mockGetTotalPending.mockResolvedValue(1);
    mockGetQueuedReviews.mockResolvedValue([]);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worksphere:review-sync-event", {
          detail: { type: "REVIEW_SYNC_SUCCESS", id: "review-1" },
        }),
      );
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });
});
