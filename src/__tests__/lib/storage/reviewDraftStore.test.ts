import { describe, it, expect, afterEach } from "@jest/globals";
import "fake-indexeddb/auto";
import {
  saveDraft,
  getDraft,
  deleteDraft,
  listDrafts,
} from "../../../lib/storage/reviewDraftStore";

describe("reviewDraftStore", () => {
  const mockVenueId = "venue-123";
  const mockDraft = {
    rating: 4,
    comment: "Great place to work!",
    amenityTags: ["wifi", "coffee"],
  };

  afterEach(async () => {
    await deleteDraft(mockVenueId);
  });

  it("should save and retrieve a draft", async () => {
    await saveDraft(mockVenueId, mockDraft);
    const saved = await getDraft(mockVenueId);

    expect(saved).toBeDefined();
    expect(saved?.venueId).toBe(mockVenueId);
    expect(saved?.comment).toBe(mockDraft.comment);
    expect(saved?.updatedAt).toBeDefined();
  });

  it("should list all saved drafts", async () => {
    await saveDraft(mockVenueId, mockDraft);
    const drafts = await listDrafts();

    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(
      drafts.some((d: { venueId: string }) => d.venueId === mockVenueId),
    ).toBe(true);
  });

  it("should delete a draft", async () => {
    await saveDraft(mockVenueId, mockDraft);
    await deleteDraft(mockVenueId);
    const deleted = await getDraft(mockVenueId);

    expect(deleted).toBeUndefined();
  });
});
