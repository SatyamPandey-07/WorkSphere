import "fake-indexeddb/auto";

// Mock navigator.serviceWorker / SyncManager so registerConversationSync's
// feature-detect branch is exercised without a real service worker.
Object.defineProperty(global.navigator, "serviceWorker", {
  value: {
    ready: Promise.resolve({
      sync: { register: jest.fn().mockResolvedValue(undefined) },
    }),
  },
  configurable: true,
});
(global as any).SyncManager = function SyncManager() {};

import {
  queueConversationRename,
  queueConversationDelete,
  getPendingConversationEdits,
  applyPendingConversationEdits,
  flushConversationEditQueue,
} from "../../lib/offlineStorage";

describe("offline conversation edit queue", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as any;
  });

  it("queues a rename action", async () => {
    await queueConversationRename("conv-1", "New Title");
    const pending = await getPendingConversationEdits();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: "conversation-rename",
      conversationId: "conv-1",
      title: "New Title",
    });
  });

  it("collapses repeated renames of the same conversation into the latest one", async () => {
    await queueConversationRename("conv-2", "First");
    await queueConversationRename("conv-2", "Second");
    await queueConversationRename("conv-2", "Third");

    const pending = await getPendingConversationEdits();
    const renamesForConv2 = pending.filter((a) => a.conversationId === "conv-2");
    expect(renamesForConv2).toHaveLength(1);
    expect(renamesForConv2[0].title).toBe("Third");
  });

  it("drops a pending rename when a delete is queued for the same conversation", async () => {
    await queueConversationRename("conv-3", "Renamed");
    await queueConversationDelete("conv-3");

    const pending = await getPendingConversationEdits();
    const actionsForConv3 = pending.filter((a) => a.conversationId === "conv-3");
    expect(actionsForConv3).toHaveLength(1);
    expect(actionsForConv3[0].type).toBe("conversation-delete");
  });

  it("applies pending edits on top of a server list: renames title and removes deleted items", () => {
    const serverList = [
      { id: "a", title: "Old A" },
      { id: "b", title: "Old B" },
      { id: "c", title: "Old C" },
    ];
    const pendingEdits = [
      { id: 1, type: "conversation-rename" as const, conversationId: "a", title: "New A", timestamp: 1 },
      { id: 2, type: "conversation-delete" as const, conversationId: "b", timestamp: 2 },
    ];

    const merged = applyPendingConversationEdits(serverList, pendingEdits);

    expect(merged).toEqual([
      { id: "a", title: "New A" },
      { id: "c", title: "Old C" },
    ]);
  });

  it("flushes queued edits to the server and clears the queue on success", async () => {
    await queueConversationRename("conv-4", "Flushed Title");

    await flushConversationEditQueue();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/conversations/conv-4",
      expect.objectContaining({ method: "PATCH" })
    );
    const pending = await getPendingConversationEdits();
    expect(pending.filter((a) => a.conversationId === "conv-4")).toHaveLength(0);
  });

  it("leaves an action queued if the flush request fails", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as any;
    await queueConversationDelete("conv-5");

    await flushConversationEditQueue();

    const pending = await getPendingConversationEdits();
    expect(pending.some((a) => a.conversationId === "conv-5")).toBe(true);
  });
});
