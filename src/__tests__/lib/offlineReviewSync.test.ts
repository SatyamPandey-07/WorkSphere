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
  getPendingReviewCount,
  requestReviewBackgroundSync,
  resolveReviewConflict,
  flushPendingReviewsClientFallback,
} from "../../lib/offlineReviewSync";

describe("offlineReviewSync", () => {
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

  it("queues an offline review with UUID, PENDING status, and retryCount 0", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-123",
      venueName: "Test Venue",
      data: {
        wifiQuality: 4,
        hasOutlets: true,
        noiseLevel: "quiet",
        comment: "Great place to work offline",
      },
    });

    expect(item).toBeDefined();
    expect(item.id).toBeDefined();
    expect(item.venueId).toBe("venue-123");
    expect(item.venueName).toBe("Test Venue");
    expect(item.status).toBe("PENDING");
    expect(item.retryCount).toBe(0);

    const pending = await getQueuedReviews();
    expect(pending.some((r) => r.id === item.id)).toBe(true);

    const count = await getPendingReviewCount();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verified that Background Sync registration was requested
    expect(mockSyncRegister).toHaveBeenCalledWith("sync-reviews");
  });

  it("updates queued review status and conflict details", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-456",
      data: { wifiQuality: 5, hasOutlets: false, noiseLevel: "moderate" },
    });

    await updateQueuedReviewStatus(item.id, "CONFLICT", {
      conflictType: "REVIEW_MODIFIED",
      message: "Server has newer review",
    });

    const reviews = await getQueuedReviews();
    const updated = reviews.find((r) => r.id === item.id);
    expect(updated?.status).toBe("CONFLICT");
    expect(updated?.conflictDetails?.conflictType).toBe("REVIEW_MODIFIED");
  });

  it("removes a queued review", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-789",
      data: { wifiQuality: 3, hasOutlets: true, noiseLevel: "loud" },
    });

    await removeQueuedReview(item.id);

    const reviews = await getQueuedReviews();
    expect(reviews.some((r) => r.id === item.id)).toBe(false);
  });

  it("resolves conflict with USE_REMOTE by discarding queued item", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-conflict-1",
      data: { wifiQuality: 2, hasOutlets: true, noiseLevel: "moderate" },
    });

    await updateQueuedReviewStatus(item.id, "CONFLICT", {
      conflictType: "REVIEW_MODIFIED",
    });

    const resolved = await resolveReviewConflict(item.id, "USE_REMOTE");
    expect(resolved).toBe(true);

    const reviews = await getQueuedReviews();
    expect(reviews.some((r) => r.id === item.id)).toBe(false);
  });

  it("resolves conflict with KEEP_LOCAL by sending forceOverwrite: true", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-conflict-2",
      data: { wifiQuality: 5, hasOutlets: true, noiseLevel: "quiet" },
    });

    await updateQueuedReviewStatus(item.id, "CONFLICT", {
      conflictType: "REVIEW_MODIFIED",
    });

    const mockFetch = jest.fn((url: string, opts?: any) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "csrf-token-abc" }),
        });
      }
      expect(url).toContain("/api/venues/venue-conflict-2/reviews");
      const body = JSON.parse(opts.body);
      expect(body.forceOverwrite).toBe(true);
      expect(opts.headers["X-Idempotency-Key"]).toBe(item.id);
      expect(opts.headers["x-csrf-token"]).toBe("csrf-token-abc");

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ rating: { id: "server-rating-keep" } }),
      });
    });
    global.fetch = mockFetch as any;

    const resolved = await resolveReviewConflict(item.id, "KEEP_LOCAL");
    expect(resolved).toBe(true);

    const reviews = await getQueuedReviews();
    expect(reviews.some((r) => r.id === item.id)).toBe(false);
  });

  it("flushes pending reviews via client fallback on reconnect", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-fallback-sync",
      data: { wifiQuality: 4, hasOutlets: true, noiseLevel: "quiet" },
    });

    const mockFetch = jest.fn((url: string, opts?: any) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "csrf-test" }),
        });
      }
      expect(url).toContain("/api/venues/venue-fallback-sync/reviews");
      expect(opts.headers["X-Idempotency-Key"]).toBe(item.id);
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ rating: { id: "synced-1" } }),
      });
    });
    global.fetch = mockFetch as any;

    const result = await flushPendingReviewsClientFallback();
    expect(result.flushed).toBe(1);

    const reviews = await getQueuedReviews();
    expect(reviews.some((r) => r.id === item.id)).toBe(false);
  });

  it("marks queued review as CONFLICT on HTTP 409 response during fallback flush", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-409",
      data: { wifiQuality: 3, hasOutlets: true, noiseLevel: "moderate" },
    });

    const mockFetch = jest.fn((url: string) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "csrf-test" }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: "Conflict",
            conflictType: "REVIEW_MODIFIED",
          }),
      });
    });
    global.fetch = mockFetch as any;

    const result = await flushPendingReviewsClientFallback();
    expect(result.conflicts).toBe(1);

    const reviews = await getQueuedReviews();
    const updated = reviews.find((r) => r.id === item.id);
    expect(updated?.status).toBe("CONFLICT");
  });

  it("marks queued review as AUTH_REQUIRED on 401 or 403 CSRF mismatch", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-csrf-403",
      data: { wifiQuality: 4, hasOutlets: true, noiseLevel: "quiet" },
    });

    global.fetch = jest.fn((url: string) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "expired-token" }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Invalid CSRF token" }),
      });
    }) as any;

    const result = await flushPendingReviewsClientFallback();
    expect(result.failures).toBe(0);

    const reviews = await getQueuedReviews();
    const updated = reviews.find((r) => r.id === item.id);
    expect(updated?.status).toBe("AUTH_REQUIRED");
  });

  it("handles 5xx server errors by incrementing retry count up to 3", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-500-retry",
      data: { wifiQuality: 4, hasOutlets: true, noiseLevel: "quiet" },
    });

    global.fetch = jest.fn((url: string) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "csrf-token" }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal Server Error" }),
      });
    }) as any;

    // Attempt 1 -> retryCount 1, still PENDING
    await flushPendingReviewsClientFallback();
    let reviews = await getQueuedReviews();
    let updated = reviews.find((r) => r.id === item.id);
    expect(updated?.retryCount).toBe(1);
    expect(updated?.status).toBe("PENDING");

    // Attempt 2 -> retryCount 2, still PENDING
    await flushPendingReviewsClientFallback();
    reviews = await getQueuedReviews();
    updated = reviews.find((r) => r.id === item.id);
    expect(updated?.retryCount).toBe(2);
    expect(updated?.status).toBe("PENDING");

    // Attempt 3 -> retryCount 3, transitions to FAILED
    await flushPendingReviewsClientFallback();
    reviews = await getQueuedReviews();
    updated = reviews.find((r) => r.id === item.id);
    expect(updated?.retryCount).toBe(3);
    expect(updated?.status).toBe("FAILED");
  });

  it("preserves item in PENDING without incrementing retry count on network failure", async () => {
    const item = await queueOfflineReview({
      venueId: "venue-net-fail",
      data: { wifiQuality: 4, hasOutlets: true, noiseLevel: "quiet" },
    });

    global.fetch = jest.fn((url: string) => {
      if (url === "/api/auth/csrf-token") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: "csrf-token" }),
        });
      }
      return Promise.reject(new TypeError("Failed to fetch"));
    }) as any;

    await flushPendingReviewsClientFallback();
    const reviews = await getQueuedReviews();
    const updated = reviews.find((r) => r.id === item.id);
    expect(updated?.retryCount).toBe(0);
    expect(updated?.status).toBe("PENDING");
  });
});
