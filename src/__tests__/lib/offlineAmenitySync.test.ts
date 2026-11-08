import "fake-indexeddb/auto";
import {
  enqueuePendingAmenityVote,
  getPendingAmenityVotes,
  removePendingAmenityVote,
  clearPendingAmenityVotes,
  replayPendingAmenityVotes,
  submitAmenityVoteOptimistic,
  setupOfflineAmenitySync,
  resetSyncDb,
  AMENITY_VOTE_STORE,
} from "@/lib/offlineSync";

describe("Offline Amenity Votes Background Sync Queue", () => {
  beforeEach(async () => {
    resetSyncDb();
    await clearPendingAmenityVotes();
    jest.clearAllMocks();
  });

  describe("IndexedDB Mutation Queue (pending_amenity_votes)", () => {
    it("enqueues and retrieves votes with { id, venueId, amenity, voteType, timestamp }", async () => {
      const vote = await enqueuePendingAmenityVote({
        venueId: "venue-sf-1",
        amenity: "wifi",
        voteType: "upvote",
        timestamp: 1000,
      });

      expect(vote.id).toBeDefined();
      expect(vote.venueId).toBe("venue-sf-1");
      expect(vote.amenity).toBe("wifi");
      expect(vote.voteType).toBe("upvote");
      expect(vote.timestamp).toBe(1000);

      const pending = await getPendingAmenityVotes();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(vote.id);
    });

    it("retrieves queued votes strictly in FIFO order (oldest timestamp first)", async () => {
      await enqueuePendingAmenityVote({
        id: "vote-2",
        venueId: "venue-1",
        amenity: "outlets",
        voteType: "upvote",
        timestamp: 2000,
      });

      await enqueuePendingAmenityVote({
        id: "vote-1",
        venueId: "venue-1",
        amenity: "wifi",
        voteType: "upvote",
        timestamp: 1000,
      });

      await enqueuePendingAmenityVote({
        id: "vote-3",
        venueId: "venue-1",
        amenity: "quietZone",
        voteType: "downvote",
        timestamp: 3000,
      });

      const pending = await getPendingAmenityVotes();
      expect(pending).toHaveLength(3);
      expect(pending[0].id).toBe("vote-1");
      expect(pending[1].id).toBe("vote-2");
      expect(pending[2].id).toBe("vote-3");
    });

    it("removes single confirmed vote from the store", async () => {
      const v1 = await enqueuePendingAmenityVote({
        venueId: "venue-1",
        amenity: "wifi",
        voteType: "upvote",
      });
      const v2 = await enqueuePendingAmenityVote({
        venueId: "venue-1",
        amenity: "outlets",
        voteType: "upvote",
      });

      await removePendingAmenityVote(v1.id);

      const pending = await getPendingAmenityVotes();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(v2.id);
    });
  });

  describe("Optimistic UI and Offline Dispatch", () => {
    it("optimistically triggers UI update and enqueues to IndexedDB when offline", async () => {
      // Simulate offline navigator
      const originalOnLine = navigator.onLine;
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
      });

      const optimisticCallback = jest.fn();

      const result = await submitAmenityVoteOptimistic({
        venueId: "venue-offline-1",
        amenity: "ergonomic",
        voteType: "upvote",
        onOptimisticUpdate: optimisticCallback,
      });

      expect(optimisticCallback).toHaveBeenCalledTimes(1);
      expect(result.syncedLive).toBe(false);
      expect(result.queuedOffline).toBe(true);

      const pending = await getPendingAmenityVotes();
      expect(pending).toHaveLength(1);
      expect(pending[0].venueId).toBe("venue-offline-1");
      expect(pending[0].amenity).toBe("ergonomic");

      // Restore navigator
      Object.defineProperty(navigator, "onLine", {
        value: originalOnLine,
        configurable: true,
      });
    });

    it("enqueues to IndexedDB if online fetch throws a network exception", async () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
      });

      global.fetch = jest.fn().mockRejectedValue(new Error("Failed to fetch (Network Error)"));

      const optimisticCallback = jest.fn();

      const result = await submitAmenityVoteOptimistic({
        venueId: "venue-net-fail",
        amenity: "wifi",
        voteType: "downvote",
        onOptimisticUpdate: optimisticCallback,
      });

      expect(optimisticCallback).toHaveBeenCalledTimes(1);
      expect(result.syncedLive).toBe(false);
      expect(result.queuedOffline).toBe(true);

      const pending = await getPendingAmenityVotes();
      expect(pending).toHaveLength(1);
      expect(pending[0].venueId).toBe("venue-net-fail");
    });
  });

  describe("Replay Engine", () => {
    it("drains the queue in FIFO order and discards confirmed votes from IndexedDB", async () => {
      await enqueuePendingAmenityVote({
        id: "vote-fifo-1",
        venueId: "venue-1",
        amenity: "wifi",
        voteType: "upvote",
        timestamp: 100,
      });
      await enqueuePendingAmenityVote({
        id: "vote-fifo-2",
        venueId: "venue-1",
        amenity: "outlets",
        voteType: "downvote",
        timestamp: 200,
      });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
      global.fetch = mockFetch;

      const summary = await replayPendingAmenityVotes("/api/venues/amenity-vote");

      expect(summary.synced).toBe(2);
      expect(summary.failed).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify FIFO order
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
        venueId: "venue-1",
        amenity: "wifi",
        isUpvote: true,
      });
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({
        venueId: "venue-1",
        amenity: "outlets",
        isUpvote: false,
      });

      // IndexedDB queue should be empty after confirmed replay
      const remaining = await getPendingAmenityVotes();
      expect(remaining).toHaveLength(0);
    });

    it("stops replay and preserves remaining items in queue on network error", async () => {
      await enqueuePendingAmenityVote({
        id: "vote-fail-1",
        venueId: "venue-1",
        amenity: "wifi",
        voteType: "upvote",
        timestamp: 100,
      });
      await enqueuePendingAmenityVote({
        id: "vote-fail-2",
        venueId: "venue-1",
        amenity: "outlets",
        voteType: "upvote",
        timestamp: 200,
      });

      global.fetch = jest.fn().mockRejectedValue(new Error("Connection refused"));

      const summary = await replayPendingAmenityVotes("/api/venues/amenity-vote");

      expect(summary.synced).toBe(0);
      expect(summary.failed).toBe(1);

      // Both items remain in queue
      const remaining = await getPendingAmenityVotes();
      expect(remaining).toHaveLength(2);
    });

    it("triggers automatic replay when 'online' event fires on window", async () => {
      await enqueuePendingAmenityVote({
        id: "vote-online-event",
        venueId: "venue-online",
        amenity: "wifi",
        voteType: "upvote",
        timestamp: 100,
      });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
      global.fetch = mockFetch;

      const cleanup = setupOfflineAmenitySync();

      // Dispatch online event
      window.dispatchEvent(new Event("online"));

      // Wait a tick for async replay
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalled();
      const remaining = await getPendingAmenityVotes();
      expect(remaining).toHaveLength(0);

      cleanup();
    });
  });
});
