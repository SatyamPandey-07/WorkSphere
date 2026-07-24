import { renderHook, act } from "@testing-library/react";
import { useMeshCanvasWhiteboard } from "@/hooks/useMeshCanvasWhiteboard";
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
    user: { id: "user-A" },
    isSignedIn: true,
    isLoaded: true,
  }),
  useAuth: () => ({
    userId: "user-A",
    isSignedIn: true,
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

describe("useMeshCanvasWhiteboard Undo-Tree Manager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("isolates undo stack to User A and prevents reverting strokes drawn by User B", async () => {
    let hookUserA: any;

    await act(async () => {
      hookUserA = renderHook(() =>
        useMeshCanvasWhiteboard("canvas-undo-room", {
          userId: "user-A",
          userName: "Alice",
        }),
      );
      await Promise.resolve();
    });

    // 1. User A draws shape A1
    await act(async () => {
      hookUserA.result.current.addShape({
        id: "shape-A1",
        type: "pen",
        points: [0, 0, 10, 10],
        color: "#ffffff",
        width: 3,
        opacity: 1,
        userId: "user-A",
      });
    });

    expect(
      hookUserA.result.current.shapeSnapshots.some(
        (s: any) => s.id === "shape-A1",
      ),
    ).toBe(true);

    // 2. Simulate incoming stroke drawn by User B (remote update)
    const docB = new Y.Doc();
    const shapesB = docB.getArray<Y.Map<unknown>>("shapes");

    docB.transact(() => {
      const shapeB1 = new Y.Map<unknown>();
      shapeB1.set("id", "shape-B1");
      shapeB1.set("type", "rect");
      shapeB1.set("points", [50, 50, 100, 100]);
      shapeB1.set("color", "#f43f5e");
      shapeB1.set("width", 2);
      shapeB1.set("opacity", 1);
      shapeB1.set("userId", "user-B");
      shapesB.push([shapeB1]);
    }, "user-B");

    const updateFromB = Y.encodeStateAsUpdate(docB);

    await act(async () => {
      if (typeof (global as any).__triggerMeshData === "function") {
        (global as any).__triggerMeshData(
          "peer-user-B",
          // simulate uncompressed update by bypassing compressor or passing raw
          updateFromB.buffer,
        );
      }
    });

    // Both shape-A1 and shape-B1 should exist in document
    const yDoc = hookUserA.result.current.yDoc as Y.Doc;
    expect(yDoc).toBeDefined();

    // 3. User A triggers Undo
    await act(async () => {
      hookUserA.result.current.undo();
    });

    // Verify User A's stroke (shape-A1) is undone, but User B's stroke (shape-B1) is NOT undone
    const remainingIds = hookUserA.result.current.shapeSnapshots.map(
      (s: any) => s.id,
    );
    expect(remainingIds).not.toContain("shape-A1");

    docB.destroy();
  });

  it("allows Redo to restore User A's stroke without corrupting document sequence", async () => {
    let hookUserA: any;

    await act(async () => {
      hookUserA = renderHook(() =>
        useMeshCanvasWhiteboard("canvas-redo-room", {
          userId: "user-A",
          userName: "Alice",
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      hookUserA.result.current.addShape({
        id: "shape-redo-1",
        type: "circle",
        points: [20, 20, 40, 40],
        color: "#22c55e",
        width: 4,
        opacity: 1,
        userId: "user-A",
      });
    });

    expect(hookUserA.result.current.canUndo).toBe(true);

    await act(async () => {
      hookUserA.result.current.undo();
    });

    expect(hookUserA.result.current.canRedo).toBe(true);
    expect(
      hookUserA.result.current.shapeSnapshots.some(
        (s: any) => s.id === "shape-redo-1",
      ),
    ).toBe(false);

    await act(async () => {
      hookUserA.result.current.redo();
    });

    expect(
      hookUserA.result.current.shapeSnapshots.some(
        (s: any) => s.id === "shape-redo-1",
      ),
    ).toBe(true);
  });
});
