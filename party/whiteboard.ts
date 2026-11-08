import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

export default class WhiteboardPartyServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onConnect(
    conn: Party.Connection,
    ctx: Party.ConnectionContext,
  ) {
    console.log(
      `[PartyKit Whiteboard] Client connected: ${conn.id} in room: ${this.room.id}`,
    );

    // y-partykit owns the Yjs synchronization protocol.
    // persist: true enables persistence through PartyKit room storage.
    return onConnect(conn, this.room, {
      persist: true,
    });
  }
}
