import type * as Party from "partykit/server";
import * as Y from "yjs";
import { onConnect } from "y-partykit";

export interface NotesSnapshotStore {
  saveSnapshot(params: {
    roomId: string;
    state: Uint8Array;
    textContent: string;
    updatedAt: Date;
  }): Promise<void>;
  loadSnapshot?(roomId: string): Promise<Uint8Array | null>;
}

const SNAPSHOT_INTERVAL_MS = 60_000;

/**
 * Default PostgreSQL snapshot persister via internal API / Prisma bridge.
 */
export const defaultPostgresSnapshotStore: NotesSnapshotStore = {
  async saveSnapshot({ roomId, state, textContent, updatedAt }) {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "http://127.0.0.1:3000";

    const encodedState = Buffer.from(state).toString("base64");

    await fetch(`${baseUrl}/api/partykit/notes-snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.PARTYKIT_INTERNAL_SECRET
          ? { "x-partykit-secret": process.env.PARTYKIT_INTERNAL_SECRET }
          : {}),
      },
      body: JSON.stringify({
        roomId,
        stateBase64: encodedState,
        textContent,
        updatedAt: updatedAt.toISOString(),
      }),
    });
  },
};

export default class CollaborativeNotesRoomServer implements Party.Server {
  private readonly doc: Y.Doc;
  private readonly store: NotesSnapshotStore;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(
    readonly room: Party.Room,
    store: NotesSnapshotStore = defaultPostgresSnapshotStore,
  ) {
    this.doc = new Y.Doc();
    this.store = store;

    this.doc.on("update", () => {
      this.dirty = true;
    });

    this.startSnapshotLoop();
  }

  private startSnapshotLoop(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setInterval(() => {
      void this.persistSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
  }

  public async persistSnapshot(force = false): Promise<boolean> {
    if (!force && !this.dirty) return false;
    const encoded = Y.encodeStateAsUpdate(this.doc);
    const textContent = this.doc.getText("group-notes").toString();

    await this.store.saveSnapshot({
      roomId: this.room.id,
      state: encoded,
      textContent,
      updatedAt: new Date(),
    });

    this.dirty = false;
    return true;
  }

  public getDoc(): Y.Doc {
    return this.doc;
  }

  public dispose(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.doc.destroy();
  }

  async onConnect(
    conn: Party.Connection,
    _ctx: Party.ConnectionContext,
  ): Promise<void> {
    return onConnect(conn, this.room, {
      persist: true,
      callback: {
        handler: async (ydoc) => {
          const update = Y.encodeStateAsUpdate(ydoc);
          Y.applyUpdate(this.doc, update, "partykit-sync");
          this.dirty = true;
        },
      },
    });
  }
}