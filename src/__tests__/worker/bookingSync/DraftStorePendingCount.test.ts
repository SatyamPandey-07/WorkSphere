/** @jest-environment jsdom */

import { DraftStore, BOOKING_DRAFT_EVENTS } from "@/worker/bookingSync/DraftStore";

describe("DraftStore Pending Count and Notification Events (#9883)", () => {
  let draftStore: DraftStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    draftStore = new DraftStore();
    await draftStore.clearAll();
  });

  afterEach(async () => {
    await draftStore.clearAll();
  });

  it("returns zero when no pending drafts exist", async () => {
    const count = await draftStore.getPendingDraftCount();
    expect(count).toBe(0);
  });

  it("counts pending unsynchronized drafts correctly", async () => {
    await draftStore.createDraft({
      id: "draft-pending-1",
      venueId: "venue-sf",
      userId: "user-1",
      payload: { dates: ["2026-12-01"] },
    });
    await draftStore.createDraft({
      id: "draft-pending-2",
      venueId: "venue-sf",
      userId: "user-1",
      payload: { dates: ["2026-12-02"] },
    });

    const count = await draftStore.getPendingDraftCount();
    expect(count).toBe(2);
  });

  it("excludes confirmed or deleted drafts from the count", async () => {
    await draftStore.createDraft({
      id: "draft-active",
      venueId: "venue-sf",
      userId: "user-1",
      payload: { dates: ["2026-12-01"] },
    });

    await draftStore.createDraft({
      id: "draft-confirmed",
      venueId: "venue-sf",
      userId: "user-1",
      payload: { dates: ["2026-12-02"], status: "CONFIRMED" },
    });

    await draftStore.createDraft({
      id: "draft-cancelled",
      venueId: "venue-sf",
      userId: "user-1",
      payload: { dates: ["2026-12-03"], status: "CANCELLED" },
    });

    let count = await draftStore.getPendingDraftCount();
    expect(count).toBe(1);

    // Delete the active draft
    await draftStore.deleteDraft("draft-active");
    count = await draftStore.getPendingDraftCount();
    expect(count).toBe(0);
  });

  it("dispatches change events when drafts are created, deleted, or cleared", async () => {
    const changeListener = jest.fn();
    window.addEventListener(BOOKING_DRAFT_EVENTS.CHANGED, changeListener);

    await draftStore.saveDraft({
      id: "draft-event-1",
      venueId: "venue-sf",
      userId: "user-1",
      payload: {},
      timestamp: Date.now(),
    });

    expect(changeListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { action: "save", draftId: "draft-event-1" },
      })
    );

    await draftStore.deleteDraft("draft-event-1");
    expect(changeListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { action: "delete", draftId: "draft-event-1" },
      })
    );

    await draftStore.clearAll();
    expect(changeListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { action: "clear" },
      })
    );

    window.removeEventListener(BOOKING_DRAFT_EVENTS.CHANGED, changeListener);
  });
});
