import * as Y from "yjs";
import type * as Party from "partykit/server";
import CollaborativeNotesRoomServer, {
  type NotesSnapshotStore,
} from "@/workers/partykitRoom";

/**
 * Helper to bidirectionally sync two Y.Doc instances (simulating PartyKit WebSocket relay)
 */
function syncDocs(docA: Y.Doc, docB: Y.Doc): void {
  const stateVectorA = Y.encodeStateVector(docA);
  const stateVectorB = Y.encodeStateVector(docB);
  const diffForB = Y.encodeStateAsUpdate(docA, stateVectorB);
  const diffForA = Y.encodeStateAsUpdate(docB, stateVectorA);
  Y.applyUpdate(docB, diffForB, "remote");
  Y.applyUpdate(docA, diffForA, "remote");
}

describe("Yjs CRDT Collaborative Notes Engine (#7228)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("converges with zero merge conflicts under concurrent edits from 6 active peers", () => {
    const peerCount = 6;
    const peers = Array.from({ length: peerCount }, (_, idx) => {
      const doc = new Y.Doc();
      return {
        id: `peer-${idx + 1}`,
        doc,
        text: doc.getText("group-notes"),
      };
    });

    // Seed initial shared document state across all peers
    peers[0].text.insert(0, "Meeting Agenda:\n");
    for (let i = 1; i < peerCount; i++) {
      syncDocs(peers[0].doc, peers[i].doc);
    }

    // All 6 peers perform concurrent edits before syncing
    peers.forEach((peer, idx) => {
      const line = `- Action item from User ${idx + 1}\n`;
      // Insert at varying positions (beginning, middle, end) concurrently
      const pos = idx % 2 === 0 ? peer.text.length : 0;
      peer.text.insert(pos, line);
    });

    // Full mesh gossip sync rounds across all 6 peers
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < peerCount; i++) {
        for (let j = i + 1; j < peerCount; j++) {
          syncDocs(peers[i].doc, peers[j].doc);
        }
      }
    }

    const canonicalText = peers[0].text.toString();

    // Every single peer must converge to the exact same CRDT state
    peers.forEach((peer, idx) => {
      expect(peer.text.toString()).toBe(canonicalText);
      expect(canonicalText).toContain(`- Action item from User ${idx + 1}\n`);
    });
    expect(canonicalText).toContain("Meeting Agenda:\n");

    peers.forEach((p) => p.doc.destroy());
  });

  it("merges offline local edits deterministically without data loss upon reconnection", () => {
    const onlinePeer = new Y.Doc();
    const offlinePeer = new Y.Doc();

    const onlineText = onlinePeer.getText("group-notes");
    const offlineText = offlinePeer.getText("group-notes");

    // Initial connected state
    onlineText.insert(0, "Shared Notes: ");
    syncDocs(onlinePeer, offlinePeer);

    // Network disconnects: both peers edit independently while partitioned
    onlineText.insert(onlineText.length, "[Online edit by Alice] ");
    offlineText.insert(offlineText.length, "[Offline cached edit by Bob]");

    expect(onlineText.toString()).not.toContain("[Offline cached edit by Bob]");
    expect(offlineText.toString()).not.toContain("[Online edit by Alice]");

    // Connection restores: CRDT state vectors exchange & merge deterministically
    syncDocs(onlinePeer, offlinePeer);

    const mergedOnline = onlineText.toString();
    const mergedOffline = offlineText.toString();

    expect(mergedOnline).toBe(mergedOffline);
    expect(mergedOnline).toContain("Shared Notes: ");
    expect(mergedOnline).toContain("[Online edit by Alice]");
    expect(mergedOnline).toContain("[Offline cached edit by Bob]");

    onlinePeer.destroy();
    offlinePeer.destroy();
  });

  it("persists state snapshots to PostgreSQL store every 60 seconds when dirty", async () => {
    jest.useFakeTimers();

    const savedSnapshots: Array<{
      roomId: string;
      state: Uint8Array;
      textContent: string;
    }> = [];

    const mockStore: NotesSnapshotStore = {
      saveSnapshot: jest.fn(async (params) => {
        savedSnapshots.push({
          roomId: params.roomId,
          state: params.state,
          textContent: params.textContent,
        });
      }),
    };

    const fakeRoom = {
      id: "notes-venue-42",
    } as unknown as Party.Room;

    const server = new CollaborativeNotesRoomServer(fakeRoom, mockStore);

    // No edits yet -> 60s tick should not write empty snapshot
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockStore.saveSnapshot).not.toHaveBeenCalled();

    // Simulate document edit
    server.getDoc().getText("group-notes").insert(0, "Snapshot test note");

    // Advance 60 seconds -> snapshot must persist to PostgreSQL store
    await jest.advanceTimersByTimeAsync(60_000);

    expect(mockStore.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(savedSnapshots[0].roomId).toBe("notes-venue-42");
    expect(savedSnapshots[0].textContent).toBe("Snapshot test note");
    expect(savedSnapshots[0].state.byteLength).toBeGreaterThan(0);

    server.dispose();
  });
});