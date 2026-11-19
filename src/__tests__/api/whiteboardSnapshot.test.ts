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

const ROOM = "room-snapshot-api";

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

const clearRoom = () =>
  DELETE(
    new NextRequest(`http://localhost/api/whiteboard?roomId=${ROOM}`, {
      method: "DELETE",
    }),
  );

describe("Whiteboard snapshot API (#7574)", () => {
  let snapshot: StoredSnapshot;
  let delta: StoredDelta;

  beforeAll(() => {
    const doc = new Y.Doc();
    doc.getText("monaco").insert(0, "baseline");
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
    deltaDoc.getText("monaco").insert(0, "post-baseline");
    const deltaUpdate = Y.encodeStateAsUpdate(deltaDoc);
    delta = {
      roomId: ROOM,
      seq: 2,
      update: deltaUpdate,
      checksum: computeSnapshotChecksum(deltaUpdate),
      createdAt: Date.now(),
    };
  });

  afterEach(async () => {
    await clearRoom();
  });

  it("persists and retrieves a compacted snapshot", async () => {
    const response = await post({
      action: "snapshot",
      snapshot: serializeSnapshot(snapshot),
    });
    expect(response.status).toBe(200);

    const data = await (await get(`roomId=${ROOM}&action=snapshot`)).json();
    expect(data.snapshot.roomId).toBe(ROOM);
    expect(data.snapshot.checksum).toBe(snapshot.checksum);
  });

  it("stores deltas until they are superseded", async () => {
    await post({ action: "delta", delta: serializeDelta(delta) });

    const before = await (await get(`roomId=${ROOM}&action=deltas`)).json();
    expect(before.deltas.map((entry: { seq: number }) => entry.seq)).toEqual([
      delta.seq,
    ]);

    const purgeResponse = await post({
      action: "purgeDeltas",
      roomId: ROOM,
      throughSeq: delta.seq,
    });
    expect(purgeResponse.status).toBe(200);

    const after = await (await get(`roomId=${ROOM}&action=deltas`)).json();
    expect(after.deltas).toHaveLength(0);
  });

  it("returns the snapshot and newer deltas together for recovery", async () => {
    await post({ action: "snapshot", snapshot: serializeSnapshot(snapshot) });
    await post({ action: "delta", delta: serializeDelta(delta) });

    const data = await (await get(`roomId=${ROOM}&action=recover`)).json();
    expect(data.snapshot.checksum).toBe(snapshot.checksum);
    expect(data.deltas).toHaveLength(1);
    expect(data.deltas[0].seq).toBe(delta.seq);
  });

  it("rejects a snapshot whose checksum does not match its update", async () => {
    const tampered = {
      ...serializeSnapshot(snapshot),
      checksum: "0000000000000000",
    };

    const response = await post({ action: "snapshot", snapshot: tampered });
    expect(response.status).toBe(400);
  });

  it("clears snapshots and deltas when the room is deleted", async () => {
    await post({ action: "snapshot", snapshot: serializeSnapshot(snapshot) });
    await post({ action: "delta", delta: serializeDelta(delta) });
    await clearRoom();

    const data = await (await get(`roomId=${ROOM}&action=recover`)).json();
    expect(data.snapshot).toBeNull();
    expect(data.deltas).toHaveLength(0);
  });
});
