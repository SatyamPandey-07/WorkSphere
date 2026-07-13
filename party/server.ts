import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import * as Y from "yjs";

export default class WorkspaceServer implements Party.Server {
  constructor(readonly room: Party.Room) {}


  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {

  onConnect(conn: Party.Connection, __ctx: Party.ConnectionContext) {

    // Yjs connection for shared state (messages, markers)
    onConnect(conn, this.room, {
      gc: true,
    });

    // Also handle simple presence via standard WebSockets
    conn.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "presence" || data.type === "cursor") {
          // Broadcast presence/cursor to everyone else in the room
          this.room.broadcast(event.data as string, [conn.id]);
        }
      } catch (err) {
        // Not JSON or other error, handled by Yjs
      }
    });
  }

  onMessage(message: string, sender: Party.Connection) {
    // Broadcast all other string messages to other clients
    // (Yjs handles ArrayBuffer messages automatically via onConnect)
    this.room.broadcast(message, [sender.id]);
  }
}
