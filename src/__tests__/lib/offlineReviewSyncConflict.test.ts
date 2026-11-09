import "fake-indexeddb/auto";

const mockSyncRegister = jest.fn().mockResolvedValue(undefined);

Object.defineProperty(global.navigator, "serviceWorker", {
  value: {
    ready: Promise.resolve({
      sync: { register: mockSyncRegister },
    }),
  },
  configurable: true,
});

(global as any).SyncManager = function SyncManager() {};

import {
  queueOfflineReview,
  getQueuedReviews,
  removeQueuedReview,
  updateQueuedReviewStatus,
  flushPendingReviewsClientFallback,
  resolveReviewConflict,
  detectConcurrentUpdate,
  applyThreeWayMerge,
} from "../../lib/offlineReviewSync";

describe("offlineReviewSync - Concurrency Control & Conflict Resolution (#4924)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ rating: { id: "server-rating-1" } }),
      }),
    ) as any;
  });

  afterEach(async () => {
    const reviews = await getQueuedReviews();
    for (const r of reviews) {
      await removeQueuedReview(r.id);
    }
  });

  it("passes baseVersionTimestamp and baseVersion in the sync payload", async () => {
    const baseTimestamp = "2026-10-08T10:00:00.000Z";
    const item = await queueOfflineReview({
      venueId: "venue-timestamp-test",
      baseVersionTimestamp: baseTimestamp,
      data: {
        wifiQuality: 4,
        hasOutlets: true,
        noiseLevel: "quiet",
        comment: "Offline edit with base version",
      },
    });

    let capturedPayload: any = null;
    global.fetch = jest.fn((url: string, opts?: any) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "csrf-token-123" }),
        });
      }
      if (url.includes("/api/venues/venue-timestamp-test/reviews")) {
        capturedPayload = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const result = await flushPendingReviewsClientFallback();
    expect(result.flushed).toBe(1);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.baseVersionTimestamp).toBe(baseTimestamp);
    expect(capturedPayload.baseVersion).toBe(baseTimestamp);
  });

  it("detects concurrent remote updates using detectConcurrentUpdate", () => {
    const baseVersionTimestamp = "2026-10-08T10:00:00.000Z";
    const newerServerUpdatedAt = "2026-10-08T11:00:00.000Z";
    const olderServerUpdatedAt = "2026-10-08T09:00:00.000Z";

    expect(
      detectConcurrentUpdate(baseVersionTimestamp, newerServerUpdatedAt),
    ).toBe(true);
    expect(
      detectConcurrentUpdate(baseVersionTimestamp, olderServerUpdatedAt),
    ).toBe(false);
  });

  it("applies three-way merge and preserves newer remote edits", () => {
    const localData = {
      wifiQuality: 5,
      hasOutlets: true,
      noiseLevel: "quiet" as const,
      comment: "Local edit: super fast wifi",
    };

    const serverReview = {
      wifiQuality: 3,
      hasOutlets: false,
      noiseLevel: "loud",
      comment: "Remote edit: renovated outlets",
      updatedAt: "2026-10-08T11:00:00.000Z",
    };

    const baseData = {
      wifiQuality: 3,
      hasOutlets: false,
      noiseLevel: "moderate" as const,
      comment: "Initial review",
    };

    // Local changed wifiQuality (3->5) and comment.
    // Server changed noiseLevel (moderate->loud).
    const merged = applyThreeWayMerge(localData, serverReview, {
      baseData,
      baseVersionTimestamp: "2026-10-08T10:00:00.000Z",
      serverUpdatedAt: "2026-10-08T11:00:00.000Z",
    });

    // Local changes preserved
    expect(merged.wifiQuality).toBe(5);
    // Remote changes preserved
    expect(merged.noiseLevel).toBe("loud");
  });

  it("marks item as CONFLICT during sync and allows resolving conflict via THREE_WAY_MERGE", async () => {
    const baseTimestamp = "2026-10-08T10:00:00.000Z";
    const serverTimestamp = "2026-10-08T11:00:00.000Z";

    const item = await queueOfflineReview({
      venueId: "venue-conflict-flow",
      baseVersionTimestamp: baseTimestamp,
      data: {
        wifiQuality: 5,
        hasOutlets: true,
        noiseLevel: "quiet",
        comment: "Offline local review",
      },
    });

    // Simulate 409 conflict during sync
    global.fetch = jest.fn((url: string) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "csrf-token-abc" }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: "Conflict",
            conflictType: "REVIEW_MODIFIED",
            serverReview: {
              wifiQuality: 4,
              hasOutlets: false,
              noiseLevel: "moderate",
              comment: "Remote user update",
              updatedAt: serverTimestamp,
            },
          }),
      });
    }) as any;

    const flushResult = await flushPendingReviewsClientFallback();
    expect(flushResult.conflicts).toBe(1);

    const reviews = await getQueuedReviews();
    const conflicted = reviews.find((r) => r.id === item.id);
    expect(conflicted?.status).toBe("CONFLICT");

    // Now resolve using THREE_WAY_MERGE
    let mergedSubmission: any = null;
    global.fetch = jest.fn((url: string, opts?: any) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "csrf-token-abc" }),
        });
      }
      if (url.includes("/api/venues/venue-conflict-flow/reviews")) {
        mergedSubmission = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ rating: { id: "merged-rating-id" } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const resolved = await resolveReviewConflict(item.id, "THREE_WAY_MERGE");
    expect(resolved).toBe(true);
    expect(mergedSubmission.forceOverwrite).toBe(true);

    // Queue item cleaned up after resolution
    const remaining = await getQueuedReviews();
    expect(remaining.some((r) => r.id === item.id)).toBe(false);
  });
});
