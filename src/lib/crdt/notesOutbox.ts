/**
 * IndexedDB outbox for offline Yjs note updates (#1023).
 *
 * Local CRDT deltas are queued while offline and flushed into the
 * live Y.Doc when PartyKit reconnects so concurrent edits aren't lost.
 *
 * #1555 – Outbox replay now detects merge conflicts so the UI can
 * prompt the user with a "Keep Local / Use Remote" choice and show
 * a notification toast after reconciliation.
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

/** Describes a single outbox entry that conflicted with remote state. */
export type NotesOutboxConflict = {
  entry: NotesOutboxEntry;
  textBefore: string;
  textAfter: string;
};

export type FlushNotesOutboxResult = {
  /** Number of non-conflicting entries that were applied. */
  flushed: number;
  /** Entries that overlapped with remote changes and need user resolution. */
  conflicts: NotesOutboxConflict[];
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
 * Re-apply queued updates into the doc (no-ops if already integrated).
 *
 * Non-conflicting entries are applied immediately; entries that would
 * modify text that was also changed remotely are returned as
 * `conflicts` so the UI can prompt the user for resolution (#1555).
 */
export async function flushNotesOutbox(
  roomId: string,
  doc: Y.Doc,
): Promise<FlushNotesOutboxResult> {
  const db = await getNotesCrdtDb();
  const pending = await db.getAllFromIndex(OUTBOX_STORE, "by-room", roomId);
  const conflicts: NotesOutboxConflict[] = [];

  for (const entry of pending) {
    const testDoc = new Y.Doc();
    Y.applyUpdate(testDoc, Y.encodeStateAsUpdate(doc));
    const testText = testDoc.getText("group-notes");
    const textBefore = testText.toString();
    Y.applyUpdate(testDoc, new Uint8Array(entry.update));
    const textAfter = testText.toString();
    testDoc.destroy();

    if (textBefore === textAfter) {
      Y.applyUpdate(doc, new Uint8Array(entry.update), "outbox-flush");
      if (entry.id != null) await db.delete(OUTBOX_STORE, entry.id);
    } else {
      conflicts.push({ entry, textBefore, textAfter });
    }
  }

  await saveNotesDocState(roomId, doc);
  return { flushed: pending.length - conflicts.length, conflicts };
}

/**
 * Apply all entries flagged as conflicts — user chose **Keep Local**.
 */
export async function resolveConflictsKeepLocal(
  roomId: string,
  doc: Y.Doc,
  conflicts: NotesOutboxConflict[],
): Promise<void> {
  const db = await getNotesCrdtDb();
  for (const c of conflicts) {
    Y.applyUpdate(doc, new Uint8Array(c.entry.update), "outbox-flush");
    if (c.entry.id != null) await db.delete(OUTBOX_STORE, c.entry.id);
  }
  await saveNotesDocState(roomId, doc);
}

/**
 * Discard conflicting entries — user chose **Use Remote**.
 */
export async function resolveConflictsUseRemote(
  roomId: string,
  conflicts: NotesOutboxConflict[],
): Promise<void> {
  const db = await getNotesCrdtDb();
  for (const c of conflicts) {
    if (c.entry.id != null) await db.delete(OUTBOX_STORE, c.entry.id);
  }
}
