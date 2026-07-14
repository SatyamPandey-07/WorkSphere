import type * as Party from "partykit/server";
import { onConnect as onConnectYjs } from "y-partykit";
import { verifyToken } from "@clerk/backend";

export default class WorkspaceServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    let isViewer = false;

    if (token) {
      try {
        const secretKey = process.env.CLERK_SECRET_KEY;
        const verifiedToken = await verifyToken(token, { secretKey });
        const userId = verifiedToken.sub;

        // Extract folder ID if room is named "folder-{id}"
        let folderId = this.room.id;
        if (folderId.startsWith("folder-")) {
          folderId = folderId.replace("folder-", "");
        }

        // Fetch user's role in the folder via Next.js internal API to avoid Edge Prisma errors
        const NEXT_PUBLIC_APP_URL =
          process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
        const authRes = await fetch(
          `${NEXT_PUBLIC_APP_URL}/api/partykit/auth?userId=${userId}&folderId=${folderId}`,
        );

        if (authRes.ok) {
          const authData = await authRes.json();
          if (authData.role === "MEMBER" || authData.role === "VIEWER") {
            isViewer = true;
          }
        } else {
          isViewer = true;
        }
      } catch (err) {
        console.error("Token verification or DB fetch failed:", err);
        // Fail-safe: if token invalid or DB fails, default to read-only
        isViewer = true;
      }
    } else {
      // Unauthenticated connections are read-only
      isViewer = true;
    }

    conn.setState({ role: isViewer ? "VIEWER" : "EDITOR" });

    // Yjs connection for shared state (messages, markers)
    // Pass readOnly option so y-partykit automatically drops incoming updates
    onConnectYjs(conn, this.room, {
      gc: true,
      readOnly: isViewer,
    });

    // Also handle simple presence via standard WebSockets
    conn.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "presence" || data.type === "cursor") {
          // Broadcast presence/cursor to everyone else in the room
          this.room.broadcast(event.data as string, [conn.id]);
        }
      } catch {
        // Not JSON or other error, handled by Yjs
      }
    });
  }

  onMessage(message: string, sender: Party.Connection) {
    const state = sender.state as { role?: string };

    try {
      const parsed = JSON.parse(message);

      // If it's a typing indicator, broadcast it safely
      if (parsed.type === "typing") {
        this.room.broadcast(message, [sender.id]);
        return;
      }

      // Prevent VIEWERS from broadcasting standard messages (like explicit map updates)
      if (state.role === "VIEWER") {
        return; // Drop the message
      }

      // Broadcast all other string messages to other clients
      // (Yjs handles ArrayBuffer messages automatically via onConnect)
      this.room.broadcast(message, [sender.id]);
    } catch {
      // Not JSON, ignore or broadcast if EDITOR
      if (state.role !== "VIEWER") {
        this.room.broadcast(message, [sender.id]);
      }
    }
  }
}
