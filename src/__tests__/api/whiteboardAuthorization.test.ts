import * as Y from "yjs";
import { NextRequest } from "next/server";
import { POST, GET, DELETE } from "@/app/api/whiteboard/route";
import {
  computeSnapshotChecksum,
  serializeDelta,
  serializeSnapshot,
  type StoredDelta,
  type StoredSnapshot,
} from "@/lib/crdt/snapshotManager";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  authorizeRoomOperation,
  clearWhiteboardAuditEvents,
  getWhiteboardAuditEvents,
  onWhiteboardAuditEvent,
  type WhiteboardAuditEvent,
} from "@/lib/whiteboard/whiteboardAuthorization";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    folderMember: {
      findUnique: jest.fn(),
    },
    folder: {
      findUnique: jest.fn(),
    },
  },
}));

const ROOM = "room-auth-test";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/whiteboard", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const get = (query: string) =>
  GET(
    new NextRequest(`http://localhost/api/whiteboard?${query}`, {
      method: "GET",
    }),
  );

const clearRoom = (roomId: string = ROOM) =>
  DELETE(
    new NextRequest(`http://localhost/api/whiteboard?roomId=${roomId}`, {
      method: "DELETE",
    }),
  );

describe("Whiteboard Snapshot Authorization (#10364)", () => {
  let snapshot: StoredSnapshot;
  let delta: StoredDelta;

  beforeAll(() => {
    const doc = new Y.Doc();
    doc.getText("monaco").insert(0, "baseline-data");
    const update = Y.encodeStateAsUpdate(doc);
    snapshot = {
      roomId: ROOM,
      update,
      stateVector: Y.encodeStateVector(doc),
      checksum: computeSnapshotChecksum(update),
      opsAtSnapshot: 1,
      createdAt: Date.now(),
    };

    const deltaDoc = new Y.Doc();
    deltaDoc.getText("monaco").insert(0, "delta-data");
    const deltaUpdate = Y.encodeStateAsUpdate(deltaDoc);
    delta = {
      roomId: ROOM,
      seq: 1,
      update: deltaUpdate,
      checksum: computeSnapshotChecksum(deltaUpdate),
      createdAt: Date.now(),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("1. Unauthenticated Requests (401)", () => {
    beforeEach(() => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
    });

    it("returns 401 when fetching snapshots without authentication", async () => {
      const res = await get(`roomId=${ROOM}&action=snapshot`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toMatch(/Unauthorized/i);
    });

    it("returns 401 when creating a snapshot without authentication", async () => {
      const res = await post({
        action: "snapshot",
        snapshot: serializeSnapshot(snapshot),
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toMatch(/Unauthorized/i);
    });

    it("returns 401 when inserting a delta without authentication", async () => {
      const res = await post({
        action: "delta",
        delta: serializeDelta(delta),
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when clearing a room without authentication via POST", async () => {
      const res = await post({
        action: "clear",
        roomId: ROOM,
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 when clearing a room without authentication via DELETE", async () => {
      const res = await clearRoom(ROOM);
      expect(res.status).toBe(401);
    });
  });

  describe("2. Unauthorized Room Membership (403)", () => {
    beforeEach(() => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "attacker-user" });
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.folder.findUnique as jest.Mock).mockResolvedValue({ ownerId: "legit-owner" });
    });

    it("returns 403 when an authenticated user attempts to read a room they do not belong to", async () => {
      const res = await get(`roomId=${ROOM}&action=snapshot`);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/Forbidden/i);
    });

    it("returns 403 when an authenticated user attempts to write to an unauthorized room", async () => {
      const res = await post({
        action: "snapshot",
        snapshot: serializeSnapshot(snapshot),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/Forbidden/i);
    });

    it("never trusts roomId alone without member verification", async () => {
      const res = await post({
        action: "deleteSnapshot",
        roomId: ROOM,
      });
      expect(res.status).toBe(403);
    });
  });

  describe("3. Read-Only (VIEWER) Members (403 for writes / destructive)", () => {
    beforeEach(() => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "viewer-user" });
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({
        role: "MEMBER", // mapped to VIEWER
      });
      (prisma.folder.findUnique as jest.Mock).mockResolvedValue({ ownerId: "legit-owner" });
    });

    it("allows VIEWER to read snapshots and deltas", async () => {
      const res = await get(`roomId=${ROOM}&action=snapshot`);
      expect(res.status).toBe(200);
    });

    it("blocks VIEWER from saving a snapshot (403)", async () => {
      const res = await post({
        action: "snapshot",
        snapshot: serializeSnapshot(snapshot),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/Read-only members cannot modify room state/i);
    });

    it("blocks VIEWER from inserting deltas (403)", async () => {
      const res = await post({
        action: "delta",
        delta: serializeDelta(delta),
      });
      expect(res.status).toBe(403);
    });

    it("blocks VIEWER from purging deltas (403)", async () => {
      const res = await post({
        action: "purgeDeltas",
        roomId: ROOM,
        throughSeq: 1,
      });
      expect(res.status).toBe(403);
    });

    it("blocks VIEWER from deleting snapshots or clearing canvas (403)", async () => {
      const postClearRes = await post({
        action: "clear",
        roomId: ROOM,
      });
      expect(postClearRes.status).toBe(403);

      const deleteRes = await clearRoom(ROOM);
      expect(deleteRes.status).toBe(403);
    });
  });

  describe("4. Authorized Editors & Owners (200 OK)", () => {
    beforeEach(() => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "editor-user" });
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({
        role: "EDITOR",
      });
      (prisma.folder.findUnique as jest.Mock).mockResolvedValue({ ownerId: "owner-user" });
    });

    it("allows EDITOR to create snapshots and retrieve them", async () => {
      const postRes = await post({
        action: "snapshot",
        snapshot: serializeSnapshot(snapshot),
      });
      expect(postRes.status).toBe(200);

      const getRes = await get(`roomId=${ROOM}&action=snapshot`);
      expect(getRes.status).toBe(200);
      const data = await getRes.json();
      expect(data.snapshot.roomId).toBe(ROOM);
    });

    it("allows EDITOR to insert deltas and purge them", async () => {
      const deltaRes = await post({
        action: "delta",
        delta: serializeDelta(delta),
      });
      expect(deltaRes.status).toBe(200);

      const purgeRes = await post({
        action: "purgeDeltas",
        roomId: ROOM,
        throughSeq: delta.seq,
      });
      expect(purgeRes.status).toBe(200);
    });

    it("allows OWNER to perform destructive canvas clear via POST and DELETE", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "owner-user" });
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({
        role: "OWNER",
      });
      (prisma.folder.findUnique as jest.Mock).mockResolvedValue({ ownerId: "owner-user" });

      const postClear = await post({ action: "clear", roomId: ROOM });
      expect(postClear.status).toBe(200);

      const deleteRes = await clearRoom(ROOM);
      expect(deleteRes.status).toBe(200);
    });
  });

  describe("5. Mutation Denial Audit Event Emission (#10435)", () => {
    beforeEach(() => {
      clearWhiteboardAuditEvents();
    });

    it("emits WHITEBOARD_MUTATION_DENIED when unauthenticated write is denied", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
      const received: WhiteboardAuditEvent[] = [];
      const unsubscribe = onWhiteboardAuditEvent((evt) => received.push(evt));

      const res = await post({
        action: "snapshot",
        snapshot: serializeSnapshot(snapshot),
      });
      unsubscribe();

      expect(res.status).toBe(401);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        eventType: "WHITEBOARD_MUTATION_DENIED",
        roomId: ROOM,
        operation: "write",
        userId: null,
        statusCode: 401,
        reason: "unauthenticated",
        requestMethod: "POST",
        requestPath: "/api/whiteboard",
      });
      expect(getWhiteboardAuditEvents({ roomId: ROOM })).toHaveLength(1);
    });

    it("emits WHITEBOARD_MUTATION_DENIED when auth throws on delete", async () => {
      (auth as unknown as jest.Mock).mockRejectedValueOnce(new Error("Clerk down"));
      const received: WhiteboardAuditEvent[] = [];
      const unsubscribe = onWhiteboardAuditEvent((evt) => received.push(evt));

      const res = await clearRoom(ROOM);
      unsubscribe();

      expect(res.status).toBe(401);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        eventType: "WHITEBOARD_MUTATION_DENIED",
        roomId: ROOM,
        operation: "delete",
        userId: null,
        statusCode: 401,
        reason: "auth_error",
        requestMethod: "DELETE",
      });
    });

    it("emits WHITEBOARD_MUTATION_DENIED when non-member or VIEWER attempts mutation", async () => {
      const received: WhiteboardAuditEvent[] = [];
      const unsubscribe = onWhiteboardAuditEvent((evt) => received.push(evt));

      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "outsider-1" });
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.folder.findUnique as jest.Mock).mockResolvedValue({ ownerId: "owner-1" });

      await post({ action: "delta", delta: serializeDelta(delta) });

      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "viewer-1" });
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({ role: "MEMBER" });

      await clearRoom(ROOM);
      unsubscribe();

      expect(received).toHaveLength(2);
      expect(received[0]).toMatchObject({
        userId: "outsider-1",
        operation: "write",
        statusCode: 403,
        reason: "not_a_member",
        isMember: false,
      });
      expect(received[1]).toMatchObject({
        userId: "viewer-1",
        operation: "delete",
        statusCode: 403,
        reason: "insufficient_role",
        role: "VIEWER",
        isMember: true,
      });

      expect(getWhiteboardAuditEvents({ userId: "viewer-1" })).toHaveLength(1);
      expect(getWhiteboardAuditEvents({ limit: 1 })).toHaveLength(1);
    });

    it("emits audit event for invalid roomId on mutation and does not emit for read denials or allowed writes", async () => {
      const received: WhiteboardAuditEvent[] = [];
      const unsubscribe = onWhiteboardAuditEvent((evt) => received.push(evt));

      // Denied read should not emit mutation-denied audit event
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
      const deniedRead = await get(`roomId=${ROOM}&action=snapshot`);
      expect(deniedRead.status).toBe(401);

      // Authorized write should not emit denial audit event
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "editor-1" });
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({ role: "EDITOR" });
      const allowedWrite = await post({
        action: "snapshot",
        snapshot: serializeSnapshot(snapshot),
      });
      expect(allowedWrite.status).toBe(200);

      // Invalid roomId on write should emit invalid_room_id
      const req = new NextRequest("http://localhost/api/whiteboard", { method: "POST" });
      const invalidRoomResult = await authorizeRoomOperation(req, "   ", "write");
      unsubscribe();

      expect(invalidRoomResult.authorized).toBe(false);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        roomId: "",
        operation: "write",
        userId: "editor-1",
        statusCode: 403,
        reason: "invalid_room_id",
      });
    });

    it("isolates listener failures and stops delivering after unsubscribe", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });
      const healthyListener = jest.fn();
      const unsubHealthy = onWhiteboardAuditEvent(healthyListener);
      const unsubThrowing = onWhiteboardAuditEvent(() => {
        throw new Error("listener boom");
      });

      const consoleErrSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const res = await post({ action: "clear", roomId: ROOM });
      consoleErrSpy.mockRestore();

      expect(res.status).toBe(401);
      expect(healthyListener).toHaveBeenCalledTimes(1);

      unsubHealthy();
      unsubThrowing();

      await post({ action: "clear", roomId: ROOM });
      expect(healthyListener).toHaveBeenCalledTimes(1);
    });
  });
});
