import {
  ClipboardSync,
  CircularHistoryBuffer,
} from "@/core/network/ClipboardSync";
import { ClipboardItem } from "@/core/crdt/ClipboardCRDT";

describe("CircularHistoryBuffer", () => {
  it("stores up to capacity and evicts oldest items in FIFO order", () => {
    const buffer = new CircularHistoryBuffer<string>(3);
    expect(buffer.size()).toBe(0);
    expect(buffer.toArray()).toEqual([]);

    buffer.push("first");
    buffer.push("second");
    expect(buffer.size()).toBe(2);
    expect(buffer.toArray()).toEqual(["second", "first"]);

    buffer.push("third");
    expect(buffer.size()).toBe(3);
    expect(buffer.toArray()).toEqual(["third", "second", "first"]);

    // Overwrite oldest ('first')
    buffer.push("fourth");
    expect(buffer.size()).toBe(3);
    expect(buffer.toArray()).toEqual(["fourth", "third", "second"]);

    // Overwrite next oldest ('second')
    buffer.push("fifth");
    expect(buffer.size()).toBe(3);
    expect(buffer.toArray()).toEqual(["fifth", "fourth", "third"]);
  });

  it("can be cleared", () => {
    const buffer = new CircularHistoryBuffer<number>(5);
    buffer.push(1);
    buffer.push(2);
    expect(buffer.size()).toBe(2);

    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.toArray()).toEqual([]);
  });
});

describe("ClipboardSync", () => {
  let syncA: ClipboardSync;
  const deviceA = "device-laptop-01";

  beforeEach(() => {
    syncA = new ClipboardSync(deviceA);
  });

  it("records added local items into the history buffer as immutable snapshots", async () => {
    const item = await syncA.addLocalItem("text", "Hello WorkSphere");
    const history = syncA.getHistory();

    expect(history).toHaveLength(1);
    const snapshot = history[0];
    expect(snapshot.revisionId).toBe(item.id);
    expect(snapshot.content).toBe("Hello WorkSphere");
    expect(snapshot.type).toBe("text");
    expect(snapshot.deviceId).toBe(deviceA);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.item)).toBe(true);

    // Verify snapshot immutability
    expect(() => {
      // @ts-expect-error mutating frozen object
      snapshot.content = "tampered";
    }).toThrow();
  });

  it("caps history buffer at maximum 15 entries and preserves newest-first ordering", async () => {
    // Add 20 items
    for (let i = 1; i <= 20; i++) {
      await syncA.addLocalItem("text", `Snippet #${i}`);
    }

    const history = syncA.getHistory();
    expect(history).toHaveLength(15);

    // Newest should be #20, oldest should be #6
    expect(history[0].content).toBe("Snippet #20");
    expect(history[14].content).toBe("Snippet #6");

    // Snippets 1 through 5 should have been rotated out
    const hasSnippet1 = history.some((entry) => entry.content === "Snippet #1");
    const hasSnippet5 = history.some((entry) => entry.content === "Snippet #5");
    expect(hasSnippet1).toBe(false);
    expect(hasSnippet5).toBe(false);
  });

  it("records remote items merged via handleRemoteItem into the history buffer", async () => {
    const remoteItem: ClipboardItem = {
      id: "remote-item-123",
      type: "image",
      content: "data:image/png;base64,iVBORw0KGgo...",
      deviceId: "device-mobile-02",
      timestamp: Date.now(),
      vectorClock: { "device-mobile-02": 1 },
    };

    let receivedRemote: ClipboardItem | null = null;
    syncA.onNewItem((item) => {
      receivedRemote = item;
    });

    await syncA.handleRemoteItem(remoteItem);

    expect(receivedRemote).toEqual(remoteItem);
    const history = syncA.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].revisionId).toBe("remote-item-123");
    expect(history[0].content).toBe(remoteItem.content);
    expect(history[0].deviceId).toBe("device-mobile-02");
  });

  it("throws an error when attempting to restore a non-existent revision ID", async () => {
    await syncA.addLocalItem("text", "Active note");

    await expect(syncA.restoreRevision("invalid-revision-id")).rejects.toThrow(
      /Revision with ID "invalid-revision-id" not found/,
    );
  });

  it("restores an earlier revision and broadcasts the correct CRDT update", async () => {
    // Set up mock WebRTC DataChannel
    const mockDataChannel = {
      readyState: "open",
      send: jest.fn(),
    } as unknown as RTCDataChannel;

    syncA.addDataChannel("peer-tablet", mockDataChannel);

    const onBroadcastSpy = jest.fn();
    syncA.onBroadcast(onBroadcastSpy);

    // Add three items sequentially
    const firstItem = await syncA.addLocalItem("text", "Initial Draft");
    await syncA.addLocalItem("text", "Second Revision");
    const thirdItem = await syncA.addLocalItem("text", "Third Revision");

    expect(syncA.getHistory()).toHaveLength(3);
    mockDataChannel.send = jest.fn(); // Reset mock before restore
    onBroadcastSpy.mockClear();

    // Restore the first item
    const restoredItem = await syncA.restoreRevision(firstItem.id);

    // Assert that the restored item has the same content and type as the first item
    expect(restoredItem.content).toBe("Initial Draft");
    expect(restoredItem.type).toBe("text");
    expect(restoredItem.deviceId).toBe(deviceA);

    // Assert that the CRDT assigned a new unique id and advanced the vector clock
    expect(restoredItem.id).not.toBe(firstItem.id);
    expect(restoredItem.vectorClock[deviceA]).toBeGreaterThan(
      thirdItem.vectorClock[deviceA],
    );

    // Assert that the update was broadcast to the WebRTC DataChannel
    expect(mockDataChannel.send).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(
      (mockDataChannel.send as jest.Mock).mock.calls[0][0],
    );
    expect(sentPayload).toEqual({
      type: "CLIPBOARD_ITEM",
      item: restoredItem,
    });

    // Assert that onBroadcast callback was notified with the restored item
    expect(onBroadcastSpy).toHaveBeenCalledWith(
      expect.any(String),
      restoredItem,
    );

    // Assert that history buffer placed the restored item at the head
    const updatedHistory = syncA.getHistory();
    expect(updatedHistory).toHaveLength(4);
    expect(updatedHistory[0].revisionId).toBe(restoredItem.id);
    expect(updatedHistory[0].content).toBe("Initial Draft");
  });
});
