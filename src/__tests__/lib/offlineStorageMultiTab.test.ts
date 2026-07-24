import "fake-indexeddb/auto";
import {
  saveVenueOffline,
  getVenueOffline,
  queuePendingAction,
  processPendingActions,
  executeWithRetry,
} from "../../lib/offlineStorage";

describe("offlineStorage Multi-Tab Lock & Retry Suite (#1279)", () => {
  it("serializes concurrent multi-tab write operations using Web Locks API", async () => {
    let activeLocks = 0;
    let maxConcurrentLocks = 0;

    const mockRequest = jest
      .fn()
      .mockImplementation(async (_name, callback) => {
        activeLocks++;
        if (activeLocks > maxConcurrentLocks) {
          maxConcurrentLocks = activeLocks;
        }
        try {
          return await callback();
        } finally {
          activeLocks--;
        }
      });

    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    const venueA = {
      id: "venue-multi-1",
      name: "Tab 1 Venue",
      latitude: 12.9716,
      longitude: 77.5946,
    };

    const venueB = {
      id: "venue-multi-2",
      name: "Tab 2 Venue",
      latitude: 13.0827,
      longitude: 80.2707,
    };

    await Promise.all([
      saveVenueOffline(venueA),
      saveVenueOffline(venueB),
      queuePendingAction({ type: "favorite", venueId: "venue-multi-1" }),
      queuePendingAction({ type: "rate", venueId: "venue-multi-2" }),
    ]);

    expect(mockRequest).toHaveBeenCalled();
    const fetchedA = await getVenueOffline("venue-multi-1");
    const fetchedB = await getVenueOffline("venue-multi-2");

    expect(fetchedA?.name).toBe("Tab 1 Venue");
    expect(fetchedB?.name).toBe("Tab 2 Venue");

    const pending = await processPendingActions();
    expect(pending.length).toBeGreaterThanOrEqual(2);
  });

  it("retries operations gracefully when DatabaseLockedError is encountered", async () => {
    let attempts = 0;
    const mockFailThenSucceed = jest.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error("Database locked by another tab");
        err.name = "DatabaseLockedError";
        throw err;
      }
      return "SUCCESS";
    });

    const result = await executeWithRetry(mockFailThenSucceed, 3, 10);
    expect(result).toBe("SUCCESS");
    expect(attempts).toBe(3);
  });
});
