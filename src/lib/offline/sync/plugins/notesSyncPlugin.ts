import type { ISyncPlugin, SyncItem, SyncResult, PendingNoteEdit } from "../../types";
import { notesRepository } from "../../repositories/notesRepository";

export class NotesSyncPlugin implements ISyncPlugin<PendingNoteEdit> {
  public readonly domain = "notes";

  async sync(items: SyncItem<PendingNoteEdit>[]): Promise<SyncResult> {
    const syncedIds: string[] = [];
    const failedIds: string[] = [];

    for (const item of items) {
      const edit = item.payload;
      try {
        const url = `/api/folders/${encodeURIComponent(edit.folderId)}/notes`;
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: edit.text,
            timestamp: edit.timestamp,
          }),
        });

        if (res.ok) {
          syncedIds.push(item.id);
          if (edit.id) {
            await notesRepository.removePendingNote(edit.id);
          }
        } else {
          failedIds.push(item.id);
        }
      } catch {
        failedIds.push(item.id);
      }
    }

    return {
      success: failedIds.length === 0,
      syncedIds,
      failedIds,
    };
  }

  async resolveConflict(
    item: SyncItem<PendingNoteEdit>,
    serverState: unknown,
  ): Promise<PendingNoteEdit | null> {
    const serverTimestamp = (serverState as any)?.updatedAt || 0;
    // Last-Write-Wins
    if (item.payload.timestamp >= serverTimestamp) {
      return item.payload;
    }
    return null;
  }
}

export const notesSyncPlugin = new NotesSyncPlugin();
