import * as Y from "yjs";
import {
  enqueueNotesUpdate,
  flushNotesOutbox,
  loadNotesDocState,
  resetNotesCrdtDbCache,
  saveNotesDocState,
  listNotesOutbox,
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
    getAllFromIndex: jest.fn(async (_store: string, _index: string, roomId: string) => {
      return [...outbox.values()].filter((row) => row.roomId === roomId);
    }),
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
    const flushed = await flushNotesOutbox("room-2", peer);
    expect(flushed).toBe(1);
    expect(peer.getText("group-notes").toString()).toBe("hello");
    expect((await listNotesOutbox("room-2")).length).toBe(0);
  });
});
