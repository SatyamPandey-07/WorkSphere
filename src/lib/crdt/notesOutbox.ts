/**
 * IndexedDB outbox for offline Yjs note updates (#1023).
 *
 * Local CRDT deltas are queued while offline and flushed into the
 * live Y.Doc when PartyKit reconnects so concurrent edits aren't lost.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import * as Y from "yjs";

const DB_NAME = "worksphere-crdt-notes";
const DB_VERSION = 1;
const OUTBOX_STORE = "outbox";
const DOC_STORE = "documents";

export type NotesOutboxEntry = {
  id?: number;
  roomId: string;
  update: number[];
  createdAt: number;
};

interface NotesCrdtDB extends DBSchema {
  outbox: {
    key: number;
    value: NotesOutboxEntry;
    indexes: { "by-room": string };
  };
  documents: {
    key: string;
    value: { roomId: string; state: number[]; updatedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<NotesCrdtDB>> | null = null;

export async function getNotesCrdtDb(): Promise<IDBPDatabase<NotesCrdtDB>> {
  if (!dbPromise) {
    dbPromise = openDB<NotesCrdtDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const outbox = db.createObjectStore(OUTBOX_STORE, {
            keyPath: "id",
            autoIncrement: true,
          });
          outbox.createIndex("by-room", "roomId");
        }
        if (!db.objectStoreNames.contains(DOC_STORE)) {
          db.createObjectStore(DOC_STORE, { keyPath: "roomId" });
        }
      },
    });
  }
  return dbPromise;
}

export function resetNotesCrdtDbCache(): void {
  dbPromise = null;
}

/** Persist a full Y.Doc snapshot for cold start / offline reload. */
export async function saveNotesDocState(
  roomId: string,
  doc: Y.Doc,
): Promise<void> {
  const db = await getNotesCrdtDb();
  const state = Array.from(Y.encodeStateAsUpdate(doc));
  await db.put(DOC_STORE, { roomId, state, updatedAt: Date.now() });
}

export async function loadNotesDocState(
  roomId: string,
): Promise<Uint8Array | null> {
  const db = await getNotesCrdtDb();
  const row = await db.get(DOC_STORE, roomId);
  if (!row) return null;
  return new Uint8Array(row.state);
}

/** Queue a local Yjs update while offline (or always, for durable replay). */
export async function enqueueNotesUpdate(
  roomId: string,
  update: Uint8Array,
): Promise<void> {
  const db = await getNotesCrdtDb();
  await db.add(OUTBOX_STORE, {
    roomId,
    update: Array.from(update),
    createdAt: Date.now(),
  });
}

export async function listNotesOutbox(
  roomId: string,
): Promise<NotesOutboxEntry[]> {
  const db = await getNotesCrdtDb();
  return db.getAllFromIndex(OUTBOX_STORE, "by-room", roomId);
}

/**
 * Re-apply queued updates into the doc (no-ops if already integrated)
 * and clear the room's outbox after a successful PartyKit reconnect.
 */
export async function flushNotesOutbox(
  roomId: string,
  doc: Y.Doc,
): Promise<number> {
  const db = await getNotesCrdtDb();
  const pending = await db.getAllFromIndex(OUTBOX_STORE, "by-room", roomId);
  for (const entry of pending) {
    Y.applyUpdate(doc, new Uint8Array(entry.update), "outbox-flush");
    if (entry.id != null) await db.delete(OUTBOX_STORE, entry.id);
  }
  await saveNotesDocState(roomId, doc);
  return pending.length;
}
