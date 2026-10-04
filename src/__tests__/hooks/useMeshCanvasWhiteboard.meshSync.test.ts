/**
 * Issue #1318: WebRTC peer-to-peer mesh canvas shape synchronization tests.
 *
 * Tests cover:
 * - Local Yjs updates sent through mesh when WebRTC is connected
 * - Yjs updates continue through PartyKit when WebRTC is unavailable
 * - Incoming mesh updates are correctly applied
 * - Mesh updates do not create an echo/rebroadcast loop
 * - WebRTC disconnection triggers PartyKit fallback
 * - WebRTC reconnection resumes mesh synchronization
 * - Canvas synchronization latency benchmark (<50ms target)
 */

import { renderHook, act } from "@testing-library/react";
import {
  useMeshCanvasWhiteboard,
  meshSendTimestamps,
} from "@/hooks/useMeshCanvasWhiteboard";
import {
  compressYjsUpdate,
  decompressYjsUpdate,
} from "@/lib/crdt/yjsCompression";
import * as Y from "yjs";

/**
 * Helper: create a correctly-sized ArrayBuffer from a Uint8Array.
 * compressYjsUpdate may return a subarray of a larger internal allocation;
 * using `.buffer` directly would include garbage bytes beyond the payload,
 * causing decompression to fail on the size guard check.
 */
function toExactArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
}

// --- Mock control state ---
let mockMeshIsConnected = true;
const mockSendToAll = jest.fn();
let capturedOnData: ((peerId: string, data: ArrayBuffer) => void) | undefined;

// Allow tests to toggle mesh connectivity and capture the onData callback
jest.mock("@/hooks/useMeshDataChannels", () => ({
  useMeshDataChannels: jest.fn().mockImplementation(({ onData }) => {
    capturedOnData = onData;
    return {
      sendToAll: mockSendToAll,
      get isConnected() {
        return mockMeshIsConnected;
      },
    };
  }),
}));

jest.mock("y-partykit/provider", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    awareness: {
      getLocalState: jest.fn().mockReturnValue({ x: 0, y: 0 }),
      setLocalState: jest.fn(),
      getStates: jest.fn().mockReturnValue(new Map()),
      on: jest.fn(),
      off: jest.fn(),
      clientID: 1,
    },
    disconnect: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  })),
}));

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { id: "test-user" },
    isSignedIn: true,
    isLoaded: true,
  }),
  useAuth: () => ({
    userId: "test-user",
    isSignedIn: true,
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

describe("Issue #1318: WebRTC mesh canvas shape synchronization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMeshIsConnected = true;
    meshSendTimestamps.clear();
  });

  // ---------- Mesh routing when WebRTC is connected ----------

  it("sends local Yjs update through mesh sendToAll when WebRTC is connected", async () => {
    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-1318-1"));
      await Promise.resolve();
    });

    await act(async () => {
      hookResult.result.current.addShape({
        id: "shape-mesh-1",
        type: "rect",
        points: [10, 10, 50, 50],
        color: "#3b82f6",
        width: 3,
        opacity: 1,
        userId: "anonymous",
      });
    });

    expect(mockSendToAll).toHaveBeenCalled();
    // Verify the sent data is a valid compressed Yjs update
    const sentBuffer = mockSendToAll.mock.calls[0][0] as ArrayBuffer;
    const sentBytes = new Uint8Array(sentBuffer);
    const decompressed = decompressYjsUpdate(sentBytes);
    expect(decompressed.length).toBeGreaterThan(0);
  });

  // ---------- PartyKit fallback when WebRTC is unavailable ----------

  it("does NOT send through mesh when WebRTC is disconnected (PartyKit fallback)", async () => {
    mockMeshIsConnected = false;

    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-1318-2"));
      await Promise.resolve();
    });

    await act(async () => {
      hookResult.result.current.addShape({
        id: "shape-fallback-1",
        type: "pen",
        points: [5, 5, 15, 15],
        color: "#f43f5e",
        width: 2,
        opacity: 1,
        userId: "anonymous",
      });
    });

    // mesh sendToAll should NOT be called when mesh is disconnected
    expect(mockSendToAll).not.toHaveBeenCalled();
    // The y-partykit provider (always active) handles sync automatically
  });

  // ---------- Incoming mesh updates applied correctly ----------

  it("correctly applies incoming compressed mesh updates to local Yjs doc", async () => {
    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-1318-3"));
      await Promise.resolve();
    });

    // Create a remote Yjs doc and produce a compressed update
    const remoteDoc = new Y.Doc();
    const remoteShapes = remoteDoc.getArray<Y.Map<unknown>>("shapes");

    remoteDoc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set("id", "remote-shape-1318");
      shape.set("type", "circle");
      shape.set("points", [100, 100, 50, 50]);
      shape.set("color", "#22c55e");
      shape.set("width", 3);
      shape.set("opacity", 0.8);
      shape.set("userId", "remote-user-42");
      remoteShapes.push([shape]);
    });

    const rawUpdate = Y.encodeStateAsUpdate(remoteDoc);
    const compressed = compressYjsUpdate(rawUpdate);

    // Simulate incoming mesh data
    await act(async () => {
      if (typeof capturedOnData === "function") {
        capturedOnData("peer-remote-42", toExactArrayBuffer(compressed));
      }
    });

    expect(
      hookResult.result.current.shapeSnapshots.some(
        (s: any) => s.id === "remote-shape-1318",
      ),
    ).toBe(true);

    remoteDoc.destroy();
  });

  // ---------- Echo/rebroadcast loop prevention ----------

  it("does NOT rebroadcast incoming mesh updates back to mesh (no echo loop)", async () => {
    await act(async () => {
      renderHook(() => useMeshCanvasWhiteboard("mesh-1318-4"));
      await Promise.resolve();
    });

    // Clear any calls from initial setup
    mockSendToAll.mockClear();

    // Create a remote update
    const remoteDoc = new Y.Doc();
    const remoteShapes = remoteDoc.getArray<Y.Map<unknown>>("shapes");

    remoteDoc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set("id", "echo-test-shape");
      shape.set("type", "line");
      shape.set("points", [0, 0, 200, 200]);
      shape.set("color", "#eab308");
      shape.set("width", 5);
      shape.set("opacity", 1);
      shape.set("userId", "peer-echo-check");
      remoteShapes.push([shape]);
    });

    const rawUpdate = Y.encodeStateAsUpdate(remoteDoc);
    const compressed = compressYjsUpdate(rawUpdate);

    // Simulate receiving this update from mesh
    await act(async () => {
      if (typeof capturedOnData === "function") {
        capturedOnData("peer-echo-test", toExactArrayBuffer(compressed));
      }
    });

    // sendToAll should NOT have been called — the "mesh" origin guard prevents echo
    expect(mockSendToAll).not.toHaveBeenCalled();

    remoteDoc.destroy();
  });

  // ---------- WebRTC disconnection triggers PartyKit fallback ----------

  it("falls back to PartyKit-only sync when WebRTC disconnects mid-session", async () => {
    // Start with mesh connected
    mockMeshIsConnected = true;

    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-1318-5"));
      await Promise.resolve();
    });

    // First shape should be sent via mesh
    await act(async () => {
      hookResult.result.current.addShape({
        id: "shape-before-disconnect",
        type: "rect",
        points: [0, 0, 100, 100],
        color: "#a855f7",
        width: 4,
        opacity: 1,
        userId: "anonymous",
      });
    });

    expect(mockSendToAll).toHaveBeenCalledTimes(1);
    mockSendToAll.mockClear();

    // Simulate WebRTC disconnection
    await act(async () => {
      mockMeshIsConnected = false;
      // Re-render to trigger the useEffect that syncs meshConnectedRef
      hookResult.rerender();
    });

    // Second shape after disconnection — should NOT go through mesh
    await act(async () => {
      hookResult.result.current.addShape({
        id: "shape-after-disconnect",
        type: "pen",
        points: [50, 50, 80, 80],
        color: "#06b6d4",
        width: 2,
        opacity: 1,
        userId: "anonymous",
      });
    });

    // Mesh should NOT be called after disconnect
    expect(mockSendToAll).not.toHaveBeenCalled();

    // But the shape should still be in local doc (PartyKit handles sync)
    expect(
      hookResult.result.current.shapeSnapshots.some(
        (s: any) => s.id === "shape-after-disconnect",
      ),
    ).toBe(true);
  });

  // ---------- WebRTC reconnection resumes mesh sync ----------

  it("resumes mesh synchronization when WebRTC reconnects", async () => {
    // Start disconnected
    mockMeshIsConnected = false;

    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-1318-6"));
      await Promise.resolve();
    });

    // Shape while disconnected — not sent through mesh
    await act(async () => {
      hookResult.result.current.addShape({
        id: "shape-while-offline",
        type: "rect",
        points: [0, 0, 50, 50],
        color: "#f97316",
        width: 3,
        opacity: 1,
        userId: "anonymous",
      });
    });

    expect(mockSendToAll).not.toHaveBeenCalled();

    // Simulate WebRTC reconnection
    await act(async () => {
      mockMeshIsConnected = true;
      hookResult.rerender();
    });

    mockSendToAll.mockClear();

    // Shape after reconnection — should go through mesh again
    await act(async () => {
      hookResult.result.current.addShape({
        id: "shape-after-reconnect",
        type: "circle",
        points: [100, 100, 30, 30],
        color: "#22c55e",
        width: 2,
        opacity: 1,
        userId: "anonymous",
      });
    });

    expect(mockSendToAll).toHaveBeenCalled();
  });

  // ---------- Latency benchmark ----------

  it("records mesh send timestamps for latency instrumentation (benchmark <50ms target)", async () => {
    mockMeshIsConnected = true;
    meshSendTimestamps.clear();

    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-1318-bench"));
      await Promise.resolve();
    });

    const t0 = performance.now();

    await act(async () => {
      hookResult.result.current.addShape({
        id: "bench-shape-1",
        type: "rect",
        points: [0, 0, 100, 100],
        color: "#3b82f6",
        width: 3,
        opacity: 1,
        userId: "anonymous",
      });
    });

    const t1 = performance.now();

    // Verify that send timestamps were recorded for benchmarking
    expect(meshSendTimestamps.size).toBeGreaterThan(0);

    // Measure local processing latency: from addShape call to sendToAll invocation
    // In a unit test environment, this measures compression + Yjs update overhead,
    // not actual WebRTC network latency. The real network latency can only be
    // measured in an integration/e2e environment with actual WebRTC peers.
    const localProcessingMs = t1 - t0;

    // The local processing overhead (Yjs update + compression + sendToAll dispatch)
    // should be well under the 50ms target. If this ever exceeds 50ms, the mesh
    // sync pipeline has a performance regression.
    expect(localProcessingMs).toBeLessThan(50);

    // Verify the recorded timestamp is reasonable (within the measured window)
    const [, recordedTimestamp] = [...meshSendTimestamps.entries()][0];
    expect(recordedTimestamp).toBeGreaterThanOrEqual(t0);
    expect(recordedTimestamp).toBeLessThanOrEqual(t1);

    // Report for CI visibility
    console.log(
      `[Issue #1318 Latency Benchmark] Local processing latency: ${localProcessingMs.toFixed(2)}ms (target: <50ms)`,
    );
  });

  // ---------- Consistency: shapes array integrity ----------

  it("preserves Yjs document consistency across mesh and local operations", async () => {
    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() =>
        useMeshCanvasWhiteboard("mesh-1318-consistency"),
      );
      await Promise.resolve();
    });

    // Add a local shape
    await act(async () => {
      hookResult.result.current.addShape({
        id: "local-shape-c1",
        type: "pen",
        points: [10, 10, 20, 20, 30, 30],
        color: "#ffffff",
        width: 2,
        opacity: 1,
        userId: "anonymous",
      });
    });

    // Apply a remote mesh update
    const remoteDoc = new Y.Doc();
    const remoteShapes = remoteDoc.getArray<Y.Map<unknown>>("shapes");
    remoteDoc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set("id", "remote-shape-c2");
      shape.set("type", "rect");
      shape.set("points", [50, 50, 100, 100]);
      shape.set("color", "#f43f5e");
      shape.set("width", 4);
      shape.set("opacity", 0.9);
      shape.set("userId", "remote-peer");
      remoteShapes.push([shape]);
    });

    const compressed = compressYjsUpdate(Y.encodeStateAsUpdate(remoteDoc));

    await act(async () => {
      if (typeof capturedOnData === "function") {
        capturedOnData("peer-consistency", toExactArrayBuffer(compressed));
      }
    });

    // Both local and remote shapes should coexist
    const snapshots = hookResult.result.current.shapeSnapshots;
    expect(snapshots.some((s: any) => s.id === "local-shape-c1")).toBe(true);
    expect(snapshots.some((s: any) => s.id === "remote-shape-c2")).toBe(true);

    remoteDoc.destroy();
  });

  // ---------- Local Undo/Redo mesh propagation ----------

  it("propagates local undo and redo operations through mesh sendToAll", async () => {
    mockMeshIsConnected = true;

    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() =>
        useMeshCanvasWhiteboard("mesh-1318-undo-redo", {
          userId: "user-undo-sync",
          userName: "UndoTester",
        }),
      );
      await Promise.resolve();
    });

    // 1. Add a shape locally
    await act(async () => {
      hookResult.result.current.addShape({
        id: "shape-to-undo",
        type: "rect",
        points: [10, 10, 80, 80],
        color: "#3b82f6",
        width: 3,
        opacity: 1,
        userId: "user-undo-sync",
      });
    });

    expect(mockSendToAll).toHaveBeenCalledTimes(1);
    mockSendToAll.mockClear();

    // 2. Perform Undo — should broadcast the inverse delta over the mesh
    await act(async () => {
      hookResult.result.current.undo();
    });

    expect(mockSendToAll).toHaveBeenCalledTimes(1);
    const undoBuffer = mockSendToAll.mock.calls[0][0] as ArrayBuffer;
    const undoDecompressed = decompressYjsUpdate(new Uint8Array(undoBuffer));
    expect(undoDecompressed.length).toBeGreaterThan(0);
    mockSendToAll.mockClear();

    // 3. Perform Redo — should broadcast the re-applied delta over the mesh
    await act(async () => {
      hookResult.result.current.redo();
    });

    expect(mockSendToAll).toHaveBeenCalledTimes(1);
    const redoBuffer = mockSendToAll.mock.calls[0][0] as ArrayBuffer;
    const redoDecompressed = decompressYjsUpdate(new Uint8Array(redoBuffer));
    expect(redoDecompressed.length).toBeGreaterThan(0);
  });
});
