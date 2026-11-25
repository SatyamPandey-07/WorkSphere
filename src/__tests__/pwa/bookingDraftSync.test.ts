/** @jest-environment jsdom */

import { DraftStore, SyncQueue, BookingDraft } from "@/worker/bookingSync";

describe("Issue #9840 - Connect Offline Booking Drafts to Reservation Flow", () => {
  let draftStore: DraftStore;
  let syncQueue: SyncQueue;

  beforeEach(async () => {
    jest.clearAllMocks();
    draftStore = new DraftStore();
    await draftStore.clearAll();
    syncQueue = new SyncQueue("test-client-node");
    await syncQueue.getDraftStore().clearAll();
  });

  describe("DraftStore Persistence & Vector Clock Monotonicity", () => {
    it("creates and stores an offline booking draft with vector clock initialized", async () => {
      const draft = await draftStore.createDraft({
        id: "draft-test-1",
        venueId: "venue-sf-cyber",
        userId: "user-nomad-01",
        payload: {
          dates: ["2026-12-01"],
          time: "10:00",
          customerEmail: "nomad@worksphere.dev",
        },
      });

      expect(draft.id).toBe("draft-test-1");
      expect(draft.vectorClock).toEqual({
        "user-nomad-01": 1,
        server: 0,
      });

      const retrieved = await draftStore.getDraft("draft-test-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.venueId).toBe("venue-sf-cyber");
      expect(retrieved?.payload).toEqual({
        dates: ["2026-12-01"],
        time: "10:00",
        customerEmail: "nomad@worksphere.dev",
      });
    });

    it("updates draft payload and advances local vector clock monotonically", async () => {
      await draftStore.createDraft({
        id: "draft-test-update",
        venueId: "venue-sf-cyber",
        userId: "user-nomad-01",
        payload: { dates: ["2026-12-01"], time: "10:00" },
      });

      const updated = await draftStore.updateDraftPayload(
        "draft-test-update",
        { time: "11:30" },
        "user-nomad-01",
      );

      expect(updated.payload.time).toBe("11:30");
      expect(updated.vectorClock?.["user-nomad-01"]).toBe(2);

      const fromStore = await draftStore.getDraft("draft-test-update");
      expect(fromStore?.payload.time).toBe("11:30");
    });

    it("retrieves all drafts and deletes successfully", async () => {
      await draftStore.createDraft({
        id: "draft-a",
        venueId: "v1",
        userId: "u1",
        payload: {},
      });
      await draftStore.createDraft({
        id: "draft-b",
        venueId: "v2",
        userId: "u2",
        payload: {},
      });

      let all = await draftStore.getAllDrafts();
      expect(all.length).toBe(2);

      await draftStore.deleteDraft("draft-a");
      all = await draftStore.getAllDrafts();
      expect(all.length).toBe(1);
      expect(all[0].id).toBe("draft-b");

      await draftStore.clearAll();
      all = await draftStore.getAllDrafts();
      expect(all.length).toBe(0);
    });
  });

  describe("SyncQueue Offline Draft Synchronization", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("processes queued offline draft, sends to /api/bookings/confirm, and dispatches synced event", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          confirmationId: "CONF-999",
          bookingId: "b-12345",
        }),
      });
      global.fetch = mockFetch;

      const syncedListener = jest.fn();
      window.addEventListener(
        "worksphere:booking-draft-synced",
        syncedListener,
      );

      const draft: BookingDraft = {
        id: "draft-sync-01",
        venueId: "venue-123",
        userId: "user-123",
        payload: {
          venue: { id: "venue-123", name: "Venue 123" },
          dates: ["2026-12-05"],
          time: "09:00",
          customerEmail: "user@example.com",
        },
        timestamp: Date.now(),
      };

      await syncQueue.getDraftStore().saveDraft(draft);

      // Trigger sync
      await syncQueue.processQueue();

      // Verify POST /api/bookings/confirm called with draft payload
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/bookings/confirm",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("draft-sync-01"),
        }),
      );

      // Verify draft removed from queue after sync
      const remaining = await syncQueue.getDraftStore().getAllDrafts();
      expect(remaining.length).toBe(0);

      // Verify custom event dispatched
      expect(syncedListener).toHaveBeenCalled();
      window.removeEventListener(
        "worksphere:booking-draft-synced",
        syncedListener,
      );
    });

    it("retains draft in store when server sync fails", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      global.fetch = mockFetch;

      const draft: BookingDraft = {
        id: "draft-fail-01",
        venueId: "venue-456",
        userId: "user-456",
        payload: {
          venue: { id: "venue-456", name: "Venue 456" },
          dates: ["2026-12-05"],
          time: "09:00",
        },
        timestamp: Date.now(),
      };

      await syncQueue.getDraftStore().saveDraft(draft);
      await syncQueue.processQueue();

      // Draft should still exist in store for next retry
      const remaining = await syncQueue.getDraftStore().getAllDrafts();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe("draft-fail-01");
    });
  });
});
