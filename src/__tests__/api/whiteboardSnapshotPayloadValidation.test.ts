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
import * as whiteboardAuth from "@/lib/whiteboard/whiteboardAuthorization";

jest.mock("@/lib/whiteboard/whiteboardAuthorization", () => ({
  authorizeRoomOperation: jest.fn(),
  extractResourceKey: jest.fn((roomId: string) => roomId),
}));

const ROOM = "room-test-payload-val";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/whiteboard", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const postRawString = (rawBody: string) =>
  POST(
    new NextRequest("http://localhost/api/whiteboard", {
      method: "POST",
      body: rawBody,
    }),
  );

const get = (query: string) =>
  GET(
    new NextRequest(`http://localhost/api/whiteboard?${query}`, {
      method: "GET",
    }),
  );

const deleteReq = (query: string) =>
  DELETE(
    new NextRequest(`http://localhost/api/whiteboard?${query}`, {
      method: "DELETE",
    }),
  );

describe("Whiteboard Snapshot Payload Validation Precedence (#10452)", () => {
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
    (whiteboardAuth.authorizeRoomOperation as jest.Mock).mockResolvedValue({
      authorized: true,
      context: { userId: "user-123", role: "OWNER", isMember: true },
    });
  });

  describe("1. Malformed Payloads Rejected Before Authorization", () => {
    it("rejects non-JSON payload before authorization is invoked", async () => {
      const res = await postRawString("not a valid json string");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid JSON payload");
      expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
    });

    it("rejects null or non-object body before authorization is invoked", async () => {
      const res = await post(null);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid request body");
      expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
    });

    it("rejects array body before authorization is invoked", async () => {
      const res = await post([{ action: "snapshot" }]);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid request body");
      expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
    });

    it("rejects missing or malformed snapshot object before authorization is invoked", async () => {
      const malformedPayloads = [
        { action: "snapshot" }, // missing snapshot
        { action: "snapshot", snapshot: null },
        { action: "snapshot", snapshot: "string-instead-of-object" },
        { action: "snapshot", snapshot: { roomId: "" } }, // empty roomId
        { action: "snapshot", snapshot: { roomId: ROOM, update: 123 } }, // invalid update type
        { action: "snapshot", snapshot: { ...serializeSnapshot(snapshot), opsAtSnapshot: -1 } }, // negative ops
        { action: "snapshot", snapshot: { ...serializeSnapshot(snapshot), createdAt: "invalid-date" } }, // invalid createdAt
      ];

      for (const payload of malformedPayloads) {
        const res = await post(payload);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("Invalid snapshot payload");
        expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
      }
    });

    it("rejects snapshot with corrupted checksum before authorization is invoked", async () => {
      const serialized = serializeSnapshot(snapshot);
      const res = await post({
        action: "snapshot",
        snapshot: {
          ...serialized,
          checksum: "corrupted-checksum-99999",
        },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Snapshot checksum mismatch");
      expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
    });

    it("rejects invalid delta payload before authorization is invoked", async () => {
      const malformedDeltas = [
        { action: "delta" }, // missing delta
        { action: "delta", delta: null },
        { action: "delta", delta: { roomId: ROOM, seq: -5 } }, // negative seq
        { action: "delta", delta: { roomId: "", seq: 1 } }, // empty roomId
      ];

      for (const payload of malformedDeltas) {
        const res = await post(payload);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("Invalid delta payload");
        expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
      }
    });

    it("rejects clear action with missing or empty roomId before authorization is invoked", async () => {
      const res = await post({ action: "clear", roomId: "" });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Missing or invalid roomId");
      expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
    });

    it("rejects GET request with missing roomId before authorization is invoked", async () => {
      const res = await get("");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Missing or invalid roomId");
      expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
    });

    it("rejects DELETE request with missing roomId before authorization is invoked", async () => {
      const res = await deleteReq("");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Missing or invalid roomId");
      expect(whiteboardAuth.authorizeRoomOperation).not.toHaveBeenCalled();
    });
  });

  describe("2. Valid Payloads Still Require Authorization", () => {
    it("denies access with 403 when authorization check fails on a valid snapshot payload", async () => {
      (whiteboardAuth.authorizeRoomOperation as jest.Mock).mockResolvedValue({
        authorized: false,
        statusCode: 403,
        error: "Forbidden: Access denied to room",
      });

      const res = await post({
        action: "snapshot",
        snapshot: serializeSnapshot(snapshot),
      });

      // Authorization was called because payload was valid
      expect(whiteboardAuth.authorizeRoomOperation).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Forbidden: Access denied to room");
    });

    it("denies access with 401 when user is unauthenticated on a valid clear action", async () => {
      (whiteboardAuth.authorizeRoomOperation as jest.Mock).mockResolvedValue({
        authorized: false,
        statusCode: 401,
        error: "Unauthorized: Authentication required",
      });

      const res = await post({ action: "clear", roomId: ROOM });

      expect(whiteboardAuth.authorizeRoomOperation).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized: Authentication required");
    });
  });

  describe("3. Valid Authorized Requests Succeed", () => {
    it("successfully creates snapshot when payload is valid and authorized", async () => {
      const res = await post({
        action: "snapshot",
        snapshot: serializeSnapshot(snapshot),
      });

      expect(whiteboardAuth.authorizeRoomOperation).toHaveBeenCalledWith(
        expect.anything(),
        ROOM,
        "write",
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.roomId).toBe(ROOM);
      expect(data.checksum).toBe(snapshot.checksum);
    });

    it("successfully appends delta when payload is valid and authorized", async () => {
      const res = await post({
        action: "delta",
        delta: serializeDelta(delta),
      });

      expect(whiteboardAuth.authorizeRoomOperation).toHaveBeenCalledWith(
        expect.anything(),
        ROOM,
        "write",
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.seq).toBe(delta.seq);
    });
  });
});
