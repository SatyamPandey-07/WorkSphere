import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

export default class FocusRoomParty implements Party.Server {
  constructor(public room: Party.Room) {}

  onConnect(conn: Party.Connection, _ctx: Party.ConnectionContext) {
    return onConnect(conn, this.room, {
      persist: true,
    });
  }
}
