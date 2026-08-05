import * as Y from "yjs";
import {
  enqueueNotesUpdate,
  flushNotesOutbox,
  loadNotesDocState,
  resetNotesCrdtDbCache,
  saveNotesDocState,
  listNotesOutbox,
  resolveConflictsKeepLocal,
  resolveConflictsUseRemote,
} from "@/lib/crdt/notesOutbox";

type Row = Record<string, unknown>;

const outbox = new Map<number, Row>();
const documents = new Map<string, Row>();
let nextId = 1;

jest.mock("idb", () => ({
  openDB: jest.fn(async () => ({
    put: jest.fn(async (store: string, value: Row) => {
      if (store === "documents") {
        documents.set(String(value.roomId), value);
      }
    }),
    add: jest.fn(async (store: string, value: Row) => {
      if (store === "outbox") {
        const id = nextId++;
        outbox.set(id, { ...value, id });
        return id;
      }
      return undefined;
    }),
    get: jest.fn(async (store: string, key: string) => {
      if (store === "documents") return documents.get(key);
      return undefined;
    }),
    getAllFromIndex: jest.fn(
      async (_store: string, _index: string, roomId: string) => {
        return [...outbox.values()].filter((row) => row.roomId === roomId);
      },
    ),
    delete: jest.fn(async (store: string, key: number) => {
      if (store === "outbox") outbox.delete(key);
    }),
  })),
}));

describe("notesOutbox", () => {
  beforeEach(() => {
    outbox.clear();
    documents.clear();
    nextId = 1;
    resetNotesCrdtDbCache();
  });

  it("persists and reloads a Y.Doc snapshot from IndexedDB", async () => {
    const doc = new Y.Doc();
    doc.getText("group-notes").insert(0, "offline note");
    await saveNotesDocState("room-1", doc);

    const loaded = await loadNotesDocState("room-1");
    expect(loaded).not.toBeNull();

    const restored = new Y.Doc();
    Y.applyUpdate(restored, loaded!);
    expect(restored.getText("group-notes").toString()).toBe("offline note");
  });

  it("queues updates and flushes them into the doc on reconnect", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("group-notes");
    text.insert(0, "hello");

    const update = Y.encodeStateAsUpdate(doc);
    await enqueueNotesUpdate("room-2", update);
    expect((await listNotesOutbox("room-2")).length).toBe(1);

    const peer = new Y.Doc();
    const result = await flushNotesOutbox("room-2", peer);
    expect(result.flushed).toBe(1);
    expect(result.conflicts).toHaveLength(0);
    expect(peer.getText("group-notes").toString()).toBe("hello");
    expect((await listNotesOutbox("room-2")).length).toBe(0);
  });

  describe("conflict detection", () => {
    it("detects no conflicts when remote state is unchanged", async () => {
      const doc = new Y.Doc();
      doc.getText("group-notes").insert(0, "base");
      await enqueueNotesUpdate("conflict-room", Y.encodeStateAsUpdate(doc));

      const receiver = new Y.Doc();
      receiver.getText("group-notes").insert(0, "base");
      const result = await flushNotesOutbox("conflict-room", receiver);
      expect(result.flushed).toBe(1);
      expect(result.conflicts).toHaveLength(0);
    });

    it("detects conflict when local edit overlaps with remote change", async () => {
      const doc = new Y.Doc();
      doc.getText("group-notes").insert(0, "Hello");

      const update = Y.encodeStateAsUpdate(doc);
      await enqueueNotesUpdate("conflict-room", update);

      const receiver = new Y.Doc();
      receiver.getText("group-notes").insert(0, "World");

      const result = await flushNotesOutbox("conflict-room", receiver);
      expect(result.flushed).toBe(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].textBefore).toBe("World");
      // Yjs resolves concurrent inserts at the same position using each
      // doc's randomly-generated clientID as a tie-breaker, so the merge
      // order ("HelloWorld" vs "WorldHello") isn't deterministic here —
      // only that both edits survived the merge.
      expect(result.conflicts[0].textAfter).toHaveLength(10);
      expect(result.conflicts[0].textAfter).toContain("Hello");
      expect(result.conflicts[0].textAfter).toContain("World");
    });

    it("applies only non-conflicting entries immediately", async () => {
      const doc = new Y.Doc();
      const update = Y.encodeStateAsUpdate(doc);
      await enqueueNotesUpdate("clean-room", update);

      const receiver = new Y.Doc();
      const result = await flushNotesOutbox("clean-room", receiver);
      expect(result.conflicts).toHaveLength(0);
    });

    it("returns empty result when outbox is empty", async () => {
      const receiver = new Y.Doc();
      const result = await flushNotesOutbox("empty-room", receiver);
      expect(result.flushed).toBe(0);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe("conflict resolution", () => {
    it("resolveConflictsKeepLocal applies the conflicting entry", async () => {
      const doc = new Y.Doc();
      doc.getText("group-notes").insert(0, "Hello");

      const update = Y.encodeStateAsUpdate(doc);
      await enqueueNotesUpdate("resolve-room", update);

      const receiver = new Y.Doc();
      receiver.getText("group-notes").insert(0, "Remote ");

      const result = await flushNotesOutbox("resolve-room", receiver);
      expect(result.conflicts).toHaveLength(1);
      expect(receiver.getText("group-notes").toString()).toBe("Remote ");

      await resolveConflictsKeepLocal(
        "resolve-room",
        receiver,
        result.conflicts,
      );

      // See the comment in "conflict detection" above — merge order between
      // two independently-created Y.Docs isn't deterministic.
      const merged = receiver.getText("group-notes").toString();
      expect(merged).toHaveLength("Remote Hello".length);
      expect(merged).toContain("Remote");
      expect(merged).toContain("Hello");
      expect((await listNotesOutbox("resolve-room")).length).toBe(0);
    });

    it("resolveConflictsUseRemote discards the conflicting entry", async () => {
      const doc = new Y.Doc();
      doc.getText("group-notes").insert(0, "Hello");
      const update = Y.encodeStateAsUpdate(doc);
      await enqueueNotesUpdate("resolve-room", update);

      const receiver = new Y.Doc();
      receiver.getText("group-notes").insert(0, "Remote ");

      const result = await flushNotesOutbox("resolve-room", receiver);
      expect(result.conflicts).toHaveLength(1);

      await resolveConflictsUseRemote("resolve-room", result.conflicts);

      expect(receiver.getText("group-notes").toString()).toBe("Remote ");
      expect((await listNotesOutbox("resolve-room")).length).toBe(0);
    });
  });
});
