import "fake-indexeddb/auto";
import {
  sortTagIdsDeterministically,
  syncFavoriteTagsBulk,
  queueFavoriteTagMutation,
  getQueuedTagMutations,
  processTagMutationsQueue,
  withFavoriteTagWebLock,
  broadcastTagSyncEvent,
  subscribeTagSyncChannel,
  TAG_SYNC_LOCK_NAME,
  TAG_SYNC_CHANNEL_NAME,
} from "@/lib/favoriteTagSync";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    favoriteTag: {
      update: jest.fn((args: unknown) => ({ __op: "update", args })),
    },
  },
}));

describe("sortTagIdsDeterministically", () => {
  it("returns tag ids in lexicographic order", () => {
    expect(sortTagIdsDeterministically(["tag-c", "tag-a", "tag-b"])).toEqual([
      "tag-a",
      "tag-b",
      "tag-c",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = ["z", "a"];
    sortTagIdsDeterministically(input);
    expect(input).toEqual(["z", "a"]);
  });
});

describe("syncFavoriteTagsBulk", () => {
  const mockTransaction = prisma.$transaction as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (ops: unknown[]) => ops);
  });

  it("returns an empty array without opening a transaction", async () => {
    await expect(syncFavoriteTagsBulk([])).resolves.toEqual([]);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("passes FavoriteTag updates to $transaction in sorted id order", async () => {
    await syncFavoriteTagsBulk([
      { id: "tag-c", name: "C" },
      { id: "tag-a", color: "#111111" },
      { id: "tag-b", name: "B", color: "#222222" },
    ]);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const ops = mockTransaction.mock.calls[0][0] as Array<{
      args: { where: { id: string }; data: Record<string, string> };
    }>;

    expect(ops.map((op) => op.args.where.id)).toEqual([
      "tag-a",
      "tag-b",
      "tag-c",
    ]);
    expect(ops[0].args.data).toEqual({ color: "#111111" });
    expect(ops[1].args.data).toEqual({ name: "B", color: "#222222" });
    expect(ops[2].args.data).toEqual({ name: "C" });
  });

  it("dedupes duplicate tag ids keeping the last payload", async () => {
    await syncFavoriteTagsBulk([
      { id: "tag-a", name: "First" },
      { id: "tag-a", name: "Second", color: "#abcdef" },
    ]);

    const ops = mockTransaction.mock.calls[0][0] as Array<{
      args: { where: { id: string }; data: Record<string, string> };
    }>;

    expect(ops).toHaveLength(1);
    expect(ops[0].args).toEqual({
      where: { id: "tag-a" },
      data: { name: "Second", color: "#abcdef" },
    });
  });
});

describe("Client-side Offline Sync", () => {
  beforeEach(() => {
    // Clear the fake indexeddb between tests
    const req = indexedDB.deleteDatabase("WorkSphereOfflineDB");
    return new Promise<void>((resolve) => {
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("queues and retrieves a tag mutation in IndexedDB", async () => {
    await queueFavoriteTagMutation("tag-1", "UPDATE", { name: "New Name" });
    const queued = await getQueuedTagMutations();

    expect(queued).toHaveLength(1);
    expect(queued[0].tagId).toBe("tag-1");
    expect(queued[0].operation).toBe("UPDATE");
    expect(queued[0].data).toEqual({ name: "New Name" });
    expect(queued[0].retryCount).toBe(0);
  });

  it("replays sequentially and dequeues on success", async () => {
    // Mock navigator.onLine
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });

    await queueFavoriteTagMutation("tag-2", "UPDATE", { name: "Test" });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    await processTagMutationsQueue();

    const queued = await getQueuedTagMutations();
    expect(queued).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts replay on permanent failure and dequeues", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });
    await queueFavoriteTagMutation("tag-3", "UPDATE", { name: "Bad" });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400, // Bad Request is permanent
    });

    await processTagMutationsQueue();

    const queued = await getQueuedTagMutations();
    expect(queued).toHaveLength(0); // Dequeued immediately on 400
  });

  it("resolves 409 conflict by fetching and merging", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });
    await queueFavoriteTagMutation("old-tag-id", "UPDATE", {
      name: "Existing Name",
    });

    global.fetch = jest
      .fn()
      // 1. Initial sync fails with 409
      .mockResolvedValueOnce({ ok: false, status: 409 })
      // 2. Fetch latest tags
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "real-tag-id", name: "Existing Name" }],
      })
      // 3. Retry sync with merged data (real-tag-id)
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await processTagMutationsQueue();

    const queued = await getQueuedTagMutations();
    expect(queued).toHaveLength(0);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const retryCall = (global.fetch as jest.Mock).mock.calls[2];
    expect(retryCall[0]).toBe("/api/favorites/tags/sync");
    expect(JSON.parse(retryCall[1].body)).toEqual({
      updates: [{ id: "real-tag-id", name: "Existing Name" }],
    });
  });

  describe("Web Locks API & BroadcastChannel Cross-Tab Synchronization (#1382)", () => {
    it("acquires Exclusive Web Lock when navigator.locks is available", async () => {
      const mockRequest = jest.fn((name, options, callback) => {
        expect(name).toBe(TAG_SYNC_LOCK_NAME);
        expect(options).toEqual({ mode: "exclusive" });
        return callback({ name });
      });

      Object.defineProperty(navigator, "locks", {
        value: { request: mockRequest },
        writable: true,
        configurable: true,
      });

      const result = await withFavoriteTagWebLock(async () => "locked-result");
      expect(result).toBe("locked-result");
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("falls back gracefully when navigator.locks is missing or unsupported", async () => {
      Object.defineProperty(navigator, "locks", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const result = await withFavoriteTagWebLock(
        async () => "fallback-result",
      );
      expect(result).toBe("fallback-result");
    });

    it("broadcasts and receives cross-tab tag sync events via BroadcastChannel", (done) => {
      const postMessageMock = jest.fn();
      const closeMock = jest.fn();
      const channelListeners = new Set<(ev: { data: any }) => void>();

      class MockBroadcastChannel {
        name: string;
        private _onmessage: ((ev: { data: any }) => void) | null = null;

        constructor(name: string) {
          this.name = name;
        }

        postMessage(data: any) {
          postMessageMock(data);
          channelListeners.forEach((listener) => listener({ data }));
        }

        close() {
          closeMock();
          if (this._onmessage) {
            channelListeners.delete(this._onmessage);
          }
        }

        set onmessage(fn: ((ev: { data: any }) => void) | null) {
          if (this._onmessage) {
            channelListeners.delete(this._onmessage);
          }
          this._onmessage = fn;
          if (fn) {
            channelListeners.add(fn);
          }
        }

        get onmessage() {
          return this._onmessage;
        }
      }

      (global as any).BroadcastChannel = MockBroadcastChannel;

      expect(TAG_SYNC_CHANNEL_NAME).toBe(
        "worksphere:favorite-tags-sync-channel",
      );

      const unsubscribe = subscribeTagSyncChannel((payload) => {
        expect(payload.type).toBe("TAG_MUTATION");
        expect(payload.tagId).toBe("tag-lock-1");
        expect(postMessageMock).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "TAG_MUTATION",
            tagId: "tag-lock-1",
          }),
        );
        unsubscribe();
        done();
      });

      broadcastTagSyncEvent({
        type: "TAG_MUTATION",
        tagId: "tag-lock-1",
        operation: "CREATE",
        data: { name: "Locked Tag" },
        timestamp: Date.now(),
      });
    });
  });
});
