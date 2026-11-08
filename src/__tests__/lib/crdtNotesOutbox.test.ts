import {
  enqueueNotesUpdate,
  listNotesOutbox,
  flushNotesOutbox,
  resetNotesCrdtDbCache,
} from "@/lib/crdt/notesOutbox";
import * as Y from "yjs";
import "fake-indexeddb/auto";

describe("Notes Outbox empty update and validation guards", () => {
  beforeEach(async () => {
    resetNotesCrdtDbCache();
  });

  it("rejects empty updates or whitespace-only room IDs", async () => {
    const emptyUpdate = new Uint8Array([]);
    const success1 = await enqueueNotesUpdate("room-123", emptyUpdate);
    expect(success1).toBe(false);

    const validUpdate = new Uint8Array([1, 2, 3]);
    const success2 = await enqueueNotesUpdate("   ", validUpdate);
    expect(success2).toBe(false);

    const outbox = await listNotesOutbox("room-123");
    expect(outbox).toHaveLength(0);
  });

  it("successfully enqueues valid CRDT updates and flushes them into Y.Doc", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("group-notes");
    text.insert(0, "Collaborative note content");

    const update = Y.encodeStateAsUpdate(doc);
    const success = await enqueueNotesUpdate("room-abc", update);
    expect(success).toBe(true);

    const outbox = await listNotesOutbox("room-abc");
    expect(outbox).toHaveLength(1);

    const targetDoc = new Y.Doc();
    const result = await flushNotesOutbox("room-abc", targetDoc);

    expect(result.flushed).toBe(1);
    expect(result.conflicts).toHaveLength(0);
    expect(targetDoc.getText("group-notes").toString()).toBe("Collaborative note content");
  });
});
