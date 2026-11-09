/**
 * Conflict-free collaborative notes for shared venue collections (#3360).
 *
 * Previously the collection note (`Folder.description`) was saved with a
 * whole-string PUT, so concurrent editors overwrote each other
 * (last-write-wins). The note now lives in a Yjs Y.Text synced over the
 * PartyKit room `folder-notes-{folderId}`. Each user's textarea edits are
 * turned into minimal character-level insert/delete ops (applyYTextDiff),
 * which Yjs merges deterministically without server locking.
 *
 * `Folder.description` becomes a plain-text snapshot of the merged note,
 * kept for list pages, PDF export and public share pages.
 */

import * as Y from "yjs";

export const COLLECTION_NOTES_TEXT_KEY = "collection-notes";
export const FOLDER_NOTES_ROOM_PREFIX = "folder-notes-";

/** Mirrors updateFolderSchema's `description` limit (the snapshot must validate). */
export const MAX_COLLECTION_NOTES_LENGTH = 500;

export function collectionNotesRoom(folderId: string): string {
  return `${FOLDER_NOTES_ROOM_PREFIX}${folderId}`;
}

export function getCollectionNotesText(doc: Y.Doc): Y.Text {
  return doc.getText(COLLECTION_NOTES_TEXT_KEY);
}

/** 32-bit FNV-1a, used to derive a stable Yjs clientID from text. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Yjs update that inserts `text` as authored by a clientID derived from the
 * text itself. Every client seeding the same legacy description produces a
 * byte-identical update, so concurrent seeding is idempotent instead of
 * duplicating the note.
 */
export function createSeedUpdate(text: string): Uint8Array {
  const seedDoc = new Y.Doc();
  // Same text → same clientID → identical structs, which Yjs de-duplicates.
  seedDoc.clientID = fnv1a(`collection-notes-seed:${text}`) || 1;
  getCollectionNotesText(seedDoc).insert(0, text);
  const update = Y.encodeStateAsUpdate(seedDoc);
  seedDoc.destroy();
  return update;
}

/**
 * Seed the shared note from the legacy description, once, after the first
 * sync — only when the shared document is still empty.
 */
export function seedCollectionNotes(doc: Y.Doc, legacyText: string | null | undefined): boolean {
  const text = (legacyText ?? "").slice(0, MAX_COLLECTION_NOTES_LENGTH);
  if (!text || getCollectionNotesText(doc).length > 0) return false;
  Y.applyUpdate(doc, createSeedUpdate(text), "seed");
  return true;
}

/** Paragraphs as the UI shows them (blank-line separated). */
export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/);
}
