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
});
