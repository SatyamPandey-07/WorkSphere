import {
  FailoverSyncManager,
  RoomSnapshotMessage,
} from "@/lib/edge/failoverSync";

describe("FailoverSyncManager", () => {
  let syncManager: FailoverSyncManager<string>;
  let sendMock: jest.Mock;

  beforeEach(() => {
    syncManager = new FailoverSyncManager<string>({ snapshotTimeoutMs: 1000 });
    sendMock = jest.fn();
  });

  test("initial state is idle and handles initial connection", () => {
    expect(syncManager.getStatus()).toBe("idle");
    syncManager.handleConnect(sendMock, "room-1");
    expect(syncManager.getStatus()).toBe("synced");
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("detects reconnection after disconnect and requests full room snapshot", () => {
    syncManager.handleConnect(sendMock, "room-1");
    syncManager.handleDisconnect();
    expect(syncManager.getStatus()).toBe("connecting");

    syncManager.handleConnect(sendMock, "room-1");
    expect(syncManager.getStatus()).toBe("syncing_snapshot");
    expect(sendMock).toHaveBeenCalledTimes(1);

    const sentPayload = JSON.parse(sendMock.mock.calls[0][0]);
    expect(sentPayload.type).toBe("request_room_snapshot");
    expect(sentPayload.roomId).toBe("room-1");
    expect(sentPayload.snapshotId).toBeDefined();
  });

  test("buffers deltas while syncing snapshot and replays post-snapshot deltas", () => {
    syncManager.handleConnect(sendMock, "room-1");
    syncManager.handleDisconnect();
    syncManager.handleConnect(sendMock, "room-1");

    const applyDeltaMock = jest.fn();

    // Buffer delta while syncing
    syncManager.handleDelta("delta-1", applyDeltaMock);
    expect(applyDeltaMock).not.toHaveBeenCalled();

    const snapshotMsg: RoomSnapshotMessage<string> = {
      type: "room_snapshot_response",
      roomId: "room-1",
      snapshotId: "snap-123",
      timestamp: Date.now() - 100, // Snapshot timestamp earlier than buffered delta
      shapes: ["shape-1", "shape-2"],
    };

    const reconcileMock = jest.fn();
    syncManager.handleSnapshotResponse(
      snapshotMsg,
      reconcileMock,
      applyDeltaMock,
    );

    expect(reconcileMock).toHaveBeenCalledWith(["shape-1", "shape-2"]);
    expect(applyDeltaMock).toHaveBeenCalledWith("delta-1");
    expect(syncManager.getStatus()).toBe("synced");
  });

  test("ignores duplicate snapshot packets", () => {
    syncManager.handleConnect(sendMock, "room-1");
    syncManager.handleDisconnect();
    syncManager.handleConnect(sendMock, "room-1");

    const snapshotMsg: RoomSnapshotMessage<string> = {
      type: "room_snapshot_response",
      roomId: "room-1",
      snapshotId: "snap-duplicate",
      timestamp: Date.now(),
      shapes: ["shape-1"],
    };

    const reconcileMock = jest.fn();
    const applyDeltaMock = jest.fn();

    const firstResult = syncManager.handleSnapshotResponse(
      snapshotMsg,
      reconcileMock,
      applyDeltaMock,
    );
    expect(firstResult).toBe(true);

    const secondResult = syncManager.handleSnapshotResponse(
      snapshotMsg,
      reconcileMock,
      applyDeltaMock,
    );
    expect(secondResult).toBe(false);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  test("handles rapid reconnect loops safely", () => {
    syncManager.handleConnect(sendMock, "room-1");

    // Reconnect loop 1
    syncManager.handleDisconnect();
    syncManager.handleConnect(sendMock, "room-1");

    // Rapid Reconnect loop 2 before snapshot returns
    syncManager.handleDisconnect();
    syncManager.handleConnect(sendMock, "room-1");

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(syncManager.getStatus()).toBe("syncing_snapshot");
  });

  test("handles empty room synchronization cleanly", () => {
    syncManager.handleConnect(sendMock, "room-empty");
    syncManager.handleDisconnect();
    syncManager.handleConnect(sendMock, "room-empty");

    const snapshotMsg: RoomSnapshotMessage<string> = {
      type: "room_snapshot_response",
      roomId: "room-empty",
      snapshotId: "snap-empty",
      timestamp: Date.now(),
      shapes: [],
    };

    const reconcileMock = jest.fn();
    const applyDeltaMock = jest.fn();

    syncManager.handleSnapshotResponse(
      snapshotMsg,
      reconcileMock,
      applyDeltaMock,
    );

    expect(reconcileMock).toHaveBeenCalledWith([]);
    expect(syncManager.getStatus()).toBe("synced");
  });
});
