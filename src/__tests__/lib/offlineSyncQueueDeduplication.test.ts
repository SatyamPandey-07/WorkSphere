import {
  OfflineSyncQueueManager,
  generateIdempotencyKey,
  createOfflineSyncQueue,
  globalSyncQueue,
  SyncQueueItem,
} from "@/lib/offlineSyncQueue";
import { enqueueOfflineMutation, useOfflineSync } from "@/hooks/useOfflineSync";
import { renderHook, act } from "@testing-library/react";

describe("Offline Mutation Store Idempotency & Duplicate Queue Entry Prevention (#4378)", () => {
  describe("generateIdempotencyKey Hashing Engine", () => {
    it("generates identical keys for identical string payloads", () => {
      const key1 = generateIdempotencyKey("booking", "desk_101");
      const key2 = generateIdempotencyKey("booking", "desk_101");

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^sync_booking_/);
    });

    it("generates different keys for different entity types with same payload", () => {
      const key1 = generateIdempotencyKey("booking", "desk_101");
      const key2 = generateIdempotencyKey("checkin", "desk_101");

      expect(key1).not.toBe(key2);
      expect(key1).toMatch(/^sync_booking_/);
      expect(key2).toMatch(/^sync_checkin_/);
    });

    it("generates different keys for different payloads with same entity type", () => {
      const key1 = generateIdempotencyKey("booking", { venueId: "venue_1", date: "2026-10-10" });
      const key2 = generateIdempotencyKey("booking", { venueId: "venue_2", date: "2026-10-10" });

      expect(key1).not.toBe(key2);
    });

    it("ensures deterministic key generation regardless of object property insertion order", () => {
      const payloadA = { venueId: "v123", time: "10:00", date: "2026-10-10" };
      const payloadB = { date: "2026-10-10", venueId: "v123", time: "10:00" };

      const keyA = generateIdempotencyKey("booking", payloadA);
      const keyB = generateIdempotencyKey("booking", payloadB);

      expect(keyA).toBe(keyB);
    });

    it("handles primitive data types gracefully (numbers, booleans, null, undefined)", () => {
      const numKey1 = generateIdempotencyKey("rating", 5);
      const numKey2 = generateIdempotencyKey("rating", 5);
      expect(numKey1).toBe(numKey2);

      const boolKey1 = generateIdempotencyKey("favorite", true);
      const boolKey2 = generateIdempotencyKey("favorite", true);
      expect(boolKey1).toBe(boolKey2);

      const nullKey1 = generateIdempotencyKey("ping", null);
      const nullKey2 = generateIdempotencyKey("ping", null);
      expect(nullKey1).toBe(nullKey2);

      const undefinedKey1 = generateIdempotencyKey("ping", undefined);
      const undefinedKey2 = generateIdempotencyKey("ping", undefined);
      expect(undefinedKey1).toBe(undefinedKey2);
    });

    it("handles nested complex JSON payloads deterministically", () => {
      const complexPayload1 = {
        venue: { id: "v10", name: "Cafe Central" },
        user: { id: "u99" },
        items: ["desk", "wifi"],
      };

      const complexPayload2 = {
        items: ["desk", "wifi"],
        user: { id: "u99" },
        venue: { id: "v10", name: "Cafe Central" },
      };

      const key1 = generateIdempotencyKey("complex_mutation", complexPayload1);
      const key2 = generateIdempotencyKey("complex_mutation", complexPayload2);

      expect(key1).toBe(key2);
    });

    it("handles special characters and unicode characters in payloads without throwing", () => {
      const payload = { title: "Café & Bakery 🥐☕", query: "WiFi + Outlets #1" };
      const key1 = generateIdempotencyKey("search", payload);
      const key2 = generateIdempotencyKey("search", payload);

      expect(key1).toBe(key2);
      expect(key1).toContain("sync_search_");
    });
  });

  describe("OfflineSyncQueueManager Duplicate Mutation Prevention", () => {
    let queue: OfflineSyncQueueManager;

    beforeEach(() => {
      queue = new OfflineSyncQueueManager();
    });

    it("prevents duplicate queue entries when enqueuing the exact same mutation multiple times", () => {
      const payload = { venueId: "venue_555", date: "2026-12-01", time: "14:00" };

      const firstItem = queue.enqueue("booking", payload);
      const secondItem = queue.enqueue("booking", payload);
      const thirdItem = queue.enqueue("booking", payload);

      expect(queue.getStats().total).toBe(1);
      expect(queue.getStats().pending).toBe(1);
      expect(secondItem.id).toBe(firstItem.id);
      expect(thirdItem.id).toBe(firstItem.id);
    });

    it("allows distinct mutations to be enqueued concurrently", () => {
      const payload1 = { venueId: "venue_1", time: "09:00" };
      const payload2 = { venueId: "venue_2", time: "10:00" };

      const item1 = queue.enqueue("booking", payload1);
      const item2 = queue.enqueue("booking", payload2);

      expect(queue.getStats().total).toBe(2);
      expect(item1.id).not.toBe(item2.id);
    });

    it("prevents duplicate enqueueing while mutation is in 'processing' status", () => {
      const payload = { venueId: "venue_777", seatId: "seat_a1" };
      const item = queue.enqueue("reserve_seat", payload);

      item.status = "processing";

      const duplicateItem = queue.enqueue("reserve_seat", payload);

      expect(duplicateItem.id).toBe(item.id);
      expect(queue.getStats().total).toBe(1);
    });

    it("prevents duplicate enqueueing while mutation is in 'retry' status awaiting backoff", () => {
      const payload = { venueId: "venue_888", seatId: "seat_b2" };
      const item = queue.enqueue("reserve_seat", payload);

      item.status = "retry";
      item.nextAttemptAt = Date.now() + 10000;

      const duplicateItem = queue.enqueue("reserve_seat", payload);

      expect(duplicateItem.id).toBe(item.id);
      expect(queue.getStats().total).toBe(1);
      expect(duplicateItem.status).toBe("retry");
    });

    it("allows re-enqueueing a mutation after the previous item completes or is cleared", () => {
      const payload = { venueId: "venue_999", action: "ADD" };
      const item1 = queue.enqueue("favorite", payload);

      item1.status = "completed";

      const item2 = queue.enqueue("favorite", payload);

      expect(item2.status).toBe("pending");
      expect(item2.attempts).toBe(0);
    });

    it("respects explicit custom ID overrides while preserving custom deduplication logic", () => {
      const payload = { venueId: "v1" };

      const item1 = queue.enqueue("favorite", payload, { id: "custom_unique_key_1" });
      const item2 = queue.enqueue("favorite", payload, { id: "custom_unique_key_1" });

      expect(item1.id).toBe("custom_unique_key_1");
      expect(item2.id).toBe("custom_unique_key_1");
      expect(queue.getStats().total).toBe(1);
    });

    it("simulates rapid offline booking submissions without generating duplicate queue entries", async () => {
      const bookingPayload = {
        venueId: "coworking_delhi_1",
        date: "2026-11-15",
        slot: "afternoon",
        userEmail: "user@worksphere.io",
      };

      // Rapidly enqueue 10 times (simulating rapid offline button clicks or reconnect loops)
      const results: SyncQueueItem[] = [];
      for (let i = 0; i < 10; i++) {
        results.push(queue.enqueue("booking_confirmation", bookingPayload));
      }

      expect(queue.getStats().total).toBe(1);
      expect(queue.getItems().length).toBe(1);
      results.forEach((res) => {
        expect(res.id).toBe(results[0].id);
      });
    });
  });

  describe("enqueueOfflineMutation Utility & Global Queue Integration", () => {
    beforeEach(() => {
      globalSyncQueue.clear();
    });

    it("enqueues mutation into globalSyncQueue with deterministic idempotency key", () => {
      const payload = { venueId: "v_global", rating: 5 };
      const item = enqueueOfflineMutation("rate_venue", payload);

      expect(item.id).toMatch(/^sync_rate_venue_/);
      expect(globalSyncQueue.getItem(item.id)).toBeDefined();
    });

    it("deduplicates globalSyncQueue mutations when called repeatedly via helper", () => {
      const payload = { noteId: "note_123", text: "Updated offline draft" };

      const item1 = enqueueOfflineMutation("edit_note", payload);
      const item2 = enqueueOfflineMutation("edit_note", payload);

      expect(item1.id).toBe(item2.id);
      expect(globalSyncQueue.getStats().total).toBe(1);
    });
  });

  describe("useOfflineSync Hook enqueueMutation Integration", () => {
    beforeEach(() => {
      globalSyncQueue.clear();
    });

    it("provides enqueueMutation function via useOfflineSync hook return", () => {
      const { result } = renderHook(() => useOfflineSync());

      expect(typeof result.current.enqueueMutation).toBe("function");

      let item: SyncQueueItem | undefined;
      act(() => {
        item = result.current.enqueueMutation("offline_review", {
          venueId: "v_hook_1",
          comment: "Great WiFi and coffee!",
        });
      });

      expect(item).toBeDefined();
      expect(item?.id).toMatch(/^sync_offline_review_/);
      expect(globalSyncQueue.getStats().total).toBe(1);
    });

    it("deduplicates queued mutations triggered through hook instance", () => {
      const { result } = renderHook(() => useOfflineSync());
      const reviewPayload = { venueId: "v_hook_2", rating: 4 };

      let itemA: SyncQueueItem | undefined;
      let itemB: SyncQueueItem | undefined;

      act(() => {
        itemA = result.current.enqueueMutation("review", reviewPayload);
        itemB = result.current.enqueueMutation("review", reviewPayload);
      });

      expect(itemA?.id).toBe(itemB?.id);
      expect(globalSyncQueue.getStats().total).toBe(1);
    });

    it("maintains distinct queues for different offline mutation types", () => {
      const { result } = renderHook(() => useOfflineSync());

      let itemFavorite: SyncQueueItem | undefined;
      let itemBooking: SyncQueueItem | undefined;
      let itemCheckIn: SyncQueueItem | undefined;

      act(() => {
        itemFavorite = result.current.enqueueMutation("favorite", { venueId: "v100" });
        itemBooking = result.current.enqueueMutation("booking", { venueId: "v100" });
        itemCheckIn = result.current.enqueueMutation("checkin", { venueId: "v100" });
      });

      expect(globalSyncQueue.getStats().total).toBe(3);
      expect(itemFavorite?.id).not.toBe(itemBooking?.id);
      expect(itemBooking?.id).not.toBe(itemCheckIn?.id);
    });
  });

  describe("Edge Cases & Rapid Reconnect Queue Resilience", () => {
    let queue: OfflineSyncQueueManager;

    beforeEach(() => {
      queue = new OfflineSyncQueueManager();
    });

    it("handles empty object and array payloads correctly", () => {
      const keyObj = generateIdempotencyKey("empty_obj", {});
      const keyArr = generateIdempotencyKey("empty_arr", []);

      expect(keyObj).toMatch(/^sync_empty_obj_/);
      expect(keyArr).toMatch(/^sync_empty_arr_/);

      const item1 = queue.enqueue("empty_obj", {});
      const item2 = queue.enqueue("empty_obj", {});

      expect(item1.id).toBe(item2.id);
      expect(queue.getStats().total).toBe(1);
    });

    it("handles large array and bulk batch payloads without performance degradation", () => {
      const bulkPayload = Array.from({ length: 100 }, (_, i) => ({
        id: `seat_${i}`,
        status: "selected",
      }));

      const key1 = generateIdempotencyKey("bulk_reserve", bulkPayload);
      const key2 = generateIdempotencyKey("bulk_reserve", bulkPayload);

      expect(key1).toBe(key2);

      const item1 = queue.enqueue("bulk_reserve", bulkPayload);
      const item2 = queue.enqueue("bulk_reserve", bulkPayload);

      expect(item1.id).toBe(item2.id);
      expect(queue.getStats().total).toBe(1);
    });

    it("preserves creation timestamp on deduplicated queue entries", async () => {
      const payload = { venueId: "venue_time_test" };

      const firstItem = queue.enqueue("timestamp_check", payload);
      const initialCreatedAt = firstItem.createdAt;

      await new Promise((resolve) => setTimeout(resolve, 20));

      const secondItem = queue.enqueue("timestamp_check", payload);

      expect(secondItem.createdAt).toBe(initialCreatedAt);
      expect(secondItem.id).toBe(firstItem.id);
    });

    it("correctly deduplicates when processing queue with concurrent workers", async () => {
      const queue = new OfflineSyncQueueManager({ concurrency: 3 });
      const payload = { venueId: "v_concurrent" };

      const item1 = queue.enqueue("concurrent_test", payload);
      const item2 = queue.enqueue("concurrent_test", payload);
      expect(queue.getStats().total).toBe(1);

      let processedCount = 0;
      await queue.process(async () => {
        processedCount++;
        // Attempt to re-enqueue while processing
        queue.enqueue("concurrent_test", payload);
      });

      expect(processedCount).toBe(1);
      expect(queue.getStats().completed).toBe(1);
    });

    it("verifies idempotency key stability across multiple execution cycles", () => {
      const venuePayload = {
        id: "venue_delhi_connaught_place",
        name: "Connaught WorkSpace",
        facilities: ["wifi", "power_outlets", "quiet_zone"],
        pricing: { hourly: 15, daily: 90 },
      };

      const keys = Array.from({ length: 50 }, () =>
        generateIdempotencyKey("venue_update", venuePayload)
      );

      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(1);
      expect(keys[0]).toMatch(/^sync_venue_update_/);
    });

    it("handles circular or non-serializable payload gracefully with fallback key", () => {
      const circularObj: any = { venueId: "v_circ" };
      circularObj.self = circularObj;

      const fallbackKey = generateIdempotencyKey("circular", circularObj);
      expect(fallbackKey).toMatch(/^sync_circular_/);

      const item = queue.enqueue("circular", circularObj);
      expect(item.id).toBeDefined();
    });
  });
});
