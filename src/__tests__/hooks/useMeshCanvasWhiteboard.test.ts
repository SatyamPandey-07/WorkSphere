import { renderHook, act } from "@testing-library/react";
import { useMeshCanvasWhiteboard } from "@/hooks/useMeshCanvasWhiteboard";
import {
  compressYjsUpdate,
  decompressYjsUpdate,
} from "@/lib/crdt/yjsCompression";
import * as Y from "yjs";

const mockSendToAll = jest.fn();

jest.mock("@/hooks/useMeshDataChannels", () => ({
  useMeshDataChannels: jest.fn().mockImplementation(({ onData }) => {
    (global as any).__triggerMeshData = onData;
    return {
      sendToAll: mockSendToAll,
      isConnected: true,
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

describe("useMeshCanvasWhiteboard hook with compression (#1427)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initializes whiteboard state and hook handlers", async () => {
    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-canvas-1"));
      await Promise.resolve();
    });

    expect(hookResult.result.current.tool).toBe("pen");
    expect(hookResult.result.current.color).toBe("#ffffff");
    expect(hookResult.result.current.isConnected).toBe(true);
  });

  it("compresses document updates before broadcasting via sendToAll", async () => {
    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-canvas-2"));
      await Promise.resolve();
    });

    await act(async () => {
      hookResult.result.current.addShape({
        id: "s1",
        type: "rect",
        points: [0, 0, 100, 100],
        color: "#f43f5e",
        width: 4,
        opacity: 1,
        userId: "user-1",
      });
    });

    expect(mockSendToAll).toHaveBeenCalled();
    const sentBuffer = mockSendToAll.mock.calls[0][0] as ArrayBuffer;
    const sentBytes = new Uint8Array(sentBuffer);

    // Verify sent packet is decompressed cleanly using decompressYjsUpdate
    const decompressed = decompressYjsUpdate(sentBytes);
    expect(decompressed.length).toBeGreaterThan(0);
  });

  it("decompresses incoming mesh updates before applying to Yjs doc", async () => {
    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useMeshCanvasWhiteboard("mesh-canvas-3"));
      await Promise.resolve();
    });

    const docSource = new Y.Doc();
    const shapesSource = docSource.getArray<Y.Map<unknown>>("shapes");

    docSource.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set("id", "remote_shape_99");
      shape.set("type", "pen");
      shape.set("points", [10, 10, 20, 20]);
      shape.set("color", "#22c55e");
      shapesSource.push([shape]);
    });

    const rawUpdate = Y.encodeStateAsUpdate(docSource);
    const compressed = compressYjsUpdate(rawUpdate);

    await act(async () => {
      if (typeof (global as any).__triggerMeshData === "function") {
        (global as any).__triggerMeshData(
          "peer_peer_123",
          compressed.buffer as ArrayBuffer,
        );
      }
    });

    // Check if remote shape was updated in snapshot
    expect(
      hookResult.result.current.shapeSnapshots.some(
        (s: any) => s.id === "remote_shape_99",
      ),
    ).toBe(true);

    docSource.destroy();
  });
});
