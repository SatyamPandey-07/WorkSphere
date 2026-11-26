import "fake-indexeddb/auto";
import {
  SYNC_TAG,
  CHECKIN_STORE_NAME,
  CHECKIN_SYNC_BROADCAST_CHANNEL,
  generateClientNonce,
  signCheckinTimestamp,
  generateIdempotencyKey,
  enqueueCheckin,
  getPendingCheckins,
  deletePendingCheckin,
  replayCheckinQueue,
  clearPendingCheckins,
  openCheckinDB,
} from "@/lib/offline/syncQueue";
import { handleSyncEvent } from "@/service-worker";

describe("PWA Offline Desk Check-in Background Sync Queue (#7427)", () => {
  const TEST_DB_NAME = "worksphere-offline-test-7427";

  beforeEach(async () => {
    await clearPendingCheckins(TEST_DB_NAME);
  });

  afterEach(async () => {
    await clearPendingCheckins(TEST_DB_NAME);
    jest.restoreAllMocks();
  });

  describe("Cryptographic Signing and Idempotency Key Generation", () => {
    it("exposes expected store and channel constants", () => {
      expect(CHECKIN_STORE_NAME).toBe("pendingCheckins");
      expect(CHECKIN_SYNC_BROADCAST_CHANNEL).toBe("nomad-checkin-sync-channel");
    });
    it("generates a unique client nonce", () => {
      const nonce1 = generateClientNonce();
      const nonce2 = generateClientNonce();
      expect(nonce1).toBeDefined();
      expect(nonce2).toBeDefined();
      expect(nonce1).not.toEqual(nonce2);
    });

    it("creates a deterministic HMAC-SHA256 signature over seatId, timestamp, and nonce", () => {
      const seatId = "seat-abc-123";
      const timestamp = 1700000000000;
      const nonce = "nonce-xyz-456";

      const sig1 = signCheckinTimestamp(seatId, timestamp, nonce);
      const sig2 = signCheckinTimestamp(seatId, timestamp, nonce);
      expect(sig1).toEqual(sig2);
      expect(typeof sig1).toBe("string");
      expect(sig1.length).toBeGreaterThan(16);

      // Tampering seatId changes signature
      const tamperedSig = signCheckinTimestamp("seat-abc-999", timestamp, nonce);
      expect(tamperedSig).not.toEqual(sig1);
    });

    it("generates a deterministic idempotency key for preventing duplicate registrations", () => {
      const seatId = "seat-101";
      const timestamp = 1700000000000;
      const nonce = "nonce-client-1";

      const key = generateIdempotencyKey(seatId, timestamp, nonce);
      expect(key).toBe(`checkin_${seatId}_${timestamp}_${nonce}`);
    });
  });

  describe("IndexedDB Persistence in Offline Mode", () => {
    it("persists offline check-in payload into IndexedDB under pendingCheckins object store", async () => {
      const payload = {
        seatId: "seat-desk-88",
        venueId: "venue-sf-01",
        userId: "user-nomad-42",
      };

      const stored = await enqueueCheckin(payload, TEST_DB_NAME);

      expect(stored.id).toBeDefined();
      expect(stored.seatId).toBe("seat-desk-88");
      expect(stored.venueId).toBe("venue-sf-01");
      expect(stored.userId).toBe("user-nomad-42");
      expect(stored.clientNonce).toBeDefined();
      expect(stored.signedTimestamp).toBeDefined();
      expect(stored.idempotencyKey).toBeDefined();
      expect(stored.status).toBe("pending");
      expect(stored.retryCount).toBe(0);

      const items = await getPendingCheckins(TEST_DB_NAME);
      expect(items).toHaveLength(1);
      expect(items[0].seatId).toBe("seat-desk-88");
      expect(items[0].idempotencyKey).toBe(stored.idempotencyKey);
    });

    it("throws error if seatId is missing", async () => {
      await expect(
        enqueueCheckin({ seatId: "" } as any, TEST_DB_NAME),
      ).rejects.toThrow("seatId is required");
    });

    it("registers SyncManager tag ('nomad-checkin-sync') when check-in is initiated offline", async () => {
      const registerMock = jest.fn().mockResolvedValue(undefined);
      const mockServiceWorker = {
        ready: Promise.resolve({
          sync: {
            register: registerMock,
          },
        }),
      };

      Object.defineProperty(global, "navigator", {
        value: {
          serviceWorker: mockServiceWorker,
        },
        writable: true,
        configurable: true,
      });

      await enqueueCheckin({ seatId: "seat-sync-test" }, TEST_DB_NAME);

      expect(registerMock).toHaveBeenCalledWith(SYNC_TAG);
      expect(registerMock).toHaveBeenCalledWith("nomad-checkin-sync");
    });
  });

  describe("Queue Drain & Idempotent Server Replay", () => {
    it("drains queue and deletes successfully synced check-ins upon network re-establishment", async () => {
      await enqueueCheckin(
        { seatId: "seat-1", venueId: "venue-1", userId: "u1" },
        TEST_DB_NAME,
      );
      await enqueueCheckin(
        { seatId: "seat-2", venueId: "venue-1", userId: "u2" },
        TEST_DB_NAME,
      );

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const result = await replayCheckinQueue({
        fetchFn: fetchMock as any,
        dbName: TEST_DB_NAME,
      });

      expect(result.totalProcessed).toBe(2);
      expect(result.synced).toHaveLength(2);
      expect(result.failed).toHaveLength(0);

      // Verify requests included idempotency and cryptographic headers
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstCallHeaders = fetchMock.mock.calls[0][1].headers;
      expect(firstCallHeaders["Idempotency-Key"]).toBeDefined();
      expect(firstCallHeaders["X-Client-Nonce"]).toBeDefined();
      expect(firstCallHeaders["X-Signed-Timestamp"]).toBeDefined();

      // Verify IndexedDB is drained
      const remaining = await getPendingCheckins(TEST_DB_NAME);
      expect(remaining).toHaveLength(0);
    });

    it("allows manual deletion of pending checkins via deletePendingCheckin", async () => {
      const item = await enqueueCheckin({ seatId: "seat-manual-del" }, TEST_DB_NAME);
      const before = await getPendingCheckins(TEST_DB_NAME);
      expect(before).toHaveLength(1);

      await deletePendingCheckin(item.id, TEST_DB_NAME);
      const after = await getPendingCheckins(TEST_DB_NAME);
      expect(after).toHaveLength(0);
    });

    it("opens checkin IndexedDB with pendingCheckins store successfully", async () => {
      const db = await openCheckinDB(TEST_DB_NAME);
      expect(db.objectStoreNames.contains(CHECKIN_STORE_NAME)).toBe(true);
      db.close();
    });

    it("treats HTTP 409 Conflict as idempotent success and removes from queue without duplicating", async () => {
      await enqueueCheckin({ seatId: "seat-dup" }, TEST_DB_NAME);

      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ message: "Check-in already recorded" }),
      });

      const result = await replayCheckinQueue({
        fetchFn: fetchMock as any,
        dbName: TEST_DB_NAME,
      });

      expect(result.synced).toHaveLength(1);
      expect(result.failed).toHaveLength(0);

      const remaining = await getPendingCheckins(TEST_DB_NAME);
      expect(remaining).toHaveLength(0);
    });

    it("allows manual deletion of pending checkins via deletePendingCheckin", async () => {
      const item = await enqueueCheckin({ seatId: "seat-manual-del" }, TEST_DB_NAME);
      const before = await getPendingCheckins(TEST_DB_NAME);
      expect(before).toHaveLength(1);

      await deletePendingCheckin(item.id, TEST_DB_NAME);
      const after = await getPendingCheckins(TEST_DB_NAME);
      expect(after).toHaveLength(0);
    });

    it("opens checkin IndexedDB with pendingCheckins store successfully", async () => {
      const db = await openCheckinDB(TEST_DB_NAME);
      expect(db.objectStoreNames.contains(CHECKIN_STORE_NAME)).toBe(true);
      db.close();
    });

    it("preserves item in queue with incremented retryCount on transient server 503 or network errors", async () => {
      await enqueueCheckin({ seatId: "seat-retry" }, TEST_DB_NAME);

      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await replayCheckinQueue({
        fetchFn: fetchMock as any,
        dbName: TEST_DB_NAME,
      });

      expect(result.synced).toHaveLength(0);
      expect(result.failed).toHaveLength(1);

      const remaining = await getPendingCheckins(TEST_DB_NAME);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].retryCount).toBe(1);
    });

    it("dispatches BroadcastChannel notification to client UI once background sync completes", async () => {
      await enqueueCheckin({ seatId: "seat-broadcast" }, TEST_DB_NAME);

      const postMessageMock = jest.fn();
      const closeMock = jest.fn();

      class MockBroadcastChannel {
        name: string;
        constructor(name: string) {
          this.name = name;
        }
        postMessage = postMessageMock;
        close = closeMock;
      }

      (global as any).BroadcastChannel = MockBroadcastChannel;

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      await replayCheckinQueue({
        fetchFn: fetchMock as any,
        dbName: TEST_DB_NAME,
      });

      expect(postMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "NOMAD_CHECKIN_SYNC_COMPLETE",
          tag: "nomad-checkin-sync",
          syncedCount: 1,
          failedCount: 0,
        }),
      );
      expect(closeMock).toHaveBeenCalled();
    });
  });

  describe("Service Worker Event Handler", () => {
    it("handles sync event with nomad-checkin-sync tag and triggers queue drain", async () => {
      await enqueueCheckin({ seatId: "seat-sw-sync" }, TEST_DB_NAME);

      const waitUntilPromises: Promise<any>[] = [];
      const event = {
        tag: "nomad-checkin-sync",
        waitUntil: (p: Promise<any>) => waitUntilPromises.push(p),
      };

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const handled = await handleSyncEvent(event, {
        fetchFn: fetchMock as any,
        dbName: TEST_DB_NAME,
      });

      expect(handled).toBe(true);
      expect(waitUntilPromises).toHaveLength(1);
      await Promise.all(waitUntilPromises);

      const remaining = await getPendingCheckins(TEST_DB_NAME);
      expect(remaining).toHaveLength(0);
    });

    it("allows manual deletion of pending checkins via deletePendingCheckin", async () => {
      const item = await enqueueCheckin({ seatId: "seat-manual-del" }, TEST_DB_NAME);
      const before = await getPendingCheckins(TEST_DB_NAME);
      expect(before).toHaveLength(1);

      await deletePendingCheckin(item.id, TEST_DB_NAME);
      const after = await getPendingCheckins(TEST_DB_NAME);
      expect(after).toHaveLength(0);
    });

    it("opens checkin IndexedDB with pendingCheckins store successfully", async () => {
      const db = await openCheckinDB(TEST_DB_NAME);
      expect(db.objectStoreNames.contains(CHECKIN_STORE_NAME)).toBe(true);
      db.close();
    });

    it("ignores unrecognized sync tags", async () => {
      const waitUntilMock = jest.fn();
      const event = {
        tag: "unrelated-sync-tag",
        waitUntil: waitUntilMock,
      };

      const handled = await handleSyncEvent(event);
      expect(handled).toBe(false);
      expect(waitUntilMock).not.toHaveBeenCalled();
    });
  });
});
