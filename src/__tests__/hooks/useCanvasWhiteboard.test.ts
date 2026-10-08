import { renderHook, act } from "@testing-library/react";
import { useCanvasWhiteboard } from "@/hooks/useCanvasWhiteboard";

const mockObserve = jest.fn();
const mockUnobserve = jest.fn();
const mockPush = jest.fn();
const mockDelete = jest.fn();
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockToArray = jest.fn().mockReturnValue([]);
const mockOn = jest.fn();
const mockOff = jest.fn();
const mockDestroy = jest.fn();
const mockDisconnect = jest.fn();
const mockGetLocalState = jest
  .fn()
  .mockReturnValue({ x: 0, y: 0, name: "Test", color: "#fff" });
const mockSetLocalState = jest.fn();
const mockGetStates = jest.fn().mockReturnValue(new Map());
const mockUndo = jest.fn();
const mockRedo = jest.fn();
const mockLength = 0;

class MockYArray {
  private items: any[] = [];
  observe = mockObserve;
  unobserve = mockUnobserve;
  observeDeep = mockObserve;
  unobserveDeep = mockUnobserve;
  push = jest.fn((items: any[]) => {
    this.items.push(...items);
    mockPush(items);
  });
  delete = mockDelete;
  get = jest.fn((index: number) => this.items[index]);
  toArray = jest.fn(() => this.items);
  get length() {
    return this.items.length;
  }
  map = jest.fn();
}

const mockAwareness = {
  getLocalState: mockGetLocalState,
  setLocalState: mockSetLocalState,
  getStates: mockGetStates,
  on: mockOn,
  off: mockOff,
  clientID: 1,
};

const mockUndoManager = {
  undo: mockUndo,
  redo: mockRedo,
  on: mockOn,
  destroy: jest.fn(),
  undoStack: { size: 0 },
  redoStack: { size: 0 },
};

let mockYArrayInstance = new MockYArray();

jest.mock("yjs", () => {
  return {
    Doc: jest.fn().mockImplementation(() => ({
      getArray: jest.fn().mockReturnValue(mockYArrayInstance),
      destroy: mockDestroy,
      on: jest.fn(),
      transact: jest.fn((cb) => cb()),
    })),
    Array: MockYArray,
    Map: jest.fn().mockImplementation(() => {
      const data = new Map<string, any>();
      return {
        get: jest.fn((key: string) => {
          mockGet(key);
          return data.get(key);
        }),
        set: jest.fn((key: string, val: any) => {
          mockSet(key, val);
          data.set(key, val);
        }),
      };
    }),
    UndoManager: jest.fn().mockImplementation(() => mockUndoManager),
  };
});

jest.mock("y-partykit/provider", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    awareness: mockAwareness,
    disconnect: mockDisconnect,
    on: jest.fn(),
    off: jest.fn(),
  })),
}));

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { id: "test-user", imageUrl: "https://example.com/avatar.png" },
    isSignedIn: true,
    isLoaded: true,
  }),
  useAuth: () => ({
    userId: "test-user",
    isSignedIn: true,
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

jest.mock("partysocket/react", () => ({
  __esModule: true,
  default: jest.fn().mockReturnValue({}),
}));

describe("useCanvasWhiteboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockYArrayInstance = new MockYArray();
  });

  it("initializes with default state when canvasId is null", () => {
    const { result } = renderHook(() => useCanvasWhiteboard(null));

    expect(result.current.tool).toBe("pen");
    expect(result.current.color).toBe("#ffffff");
    expect(result.current.strokeWidth).toBe(3);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.remoteCursors).toEqual([]);
    expect(result.current.shapeSnapshots).toEqual([]);
  });

  it("provides tool, color, and stroke width setters", () => {
    const { result } = renderHook(() => useCanvasWhiteboard("test-canvas"));

    act(() => result.current.setTool("rect"));
    expect(result.current.tool).toBe("rect");

    act(() => result.current.setColor("#22c55e"));
    expect(result.current.color).toBe("#22c55e");

    act(() => result.current.setStrokeWidth(8));
    expect(result.current.strokeWidth).toBe(8);
  });

  it("can undo and redo", () => {
    const { result } = renderHook(() => useCanvasWhiteboard("test-canvas"));

    act(() => result.current.undo());
    expect(mockUndo).toHaveBeenCalledTimes(1);

    act(() => result.current.redo());
    expect(mockRedo).toHaveBeenCalledTimes(1);
  });

  it("updates cursor position via awareness", () => {
    const { result } = renderHook(() => useCanvasWhiteboard("test-canvas"));

    act(() => result.current.updateCursor(150, 200));

    expect(mockSetLocalState).toHaveBeenCalledWith(
      expect.objectContaining({ x: 150, y: 200 }),
    );
  });

  describe("stroke broadcast debouncing and point throttling (#4918)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("buffers raw coordinate points during active strokes and dispatches point batches via 16ms throttle interval", () => {
      const { result } = renderHook(() => useCanvasWhiteboard("test-canvas"));

      act(() => {
        result.current.addShape({
          id: "stroke-4918",
          type: "pen",
          points: [0, 0],
          color: "#ffffff",
          width: 3,
          opacity: 1,
          userId: "user-1",
        });
      });

      // Simulate high-frequency mousemove events dispatching coordinate points
      act(() => {
        result.current.broadcastStroke("stroke-4918", [0, 0, 10, 10]);
        result.current.broadcastStroke("stroke-4918", [0, 0, 10, 10, 20, 20]);
        result.current.broadcastStroke("stroke-4918", [0, 0, 10, 10, 20, 20, 30, 30]);
      });

      // Before 16ms interval, updates are buffered and not yet committed
      expect(mockSet).not.toHaveBeenCalledWith("points", [0, 0, 10, 10, 20, 20, 30, 30]);

      // Advance by throttle interval (16ms)
      act(() => {
        jest.advanceTimersByTime(16);
      });

      // Dispatched batched points in a single transaction
      expect(mockSet).toHaveBeenCalledWith("points", [0, 0, 10, 10, 20, 20, 30, 30]);
    });

    it("throttles high-frequency updateShape point broadcasts during mouse move", () => {
      const { result } = renderHook(() => useCanvasWhiteboard("test-canvas"));

      act(() => {
        result.current.addShape({
          id: "stroke-move",
          type: "pen",
          points: [0, 0],
          color: "#ffffff",
          width: 3,
          opacity: 1,
          userId: "user-1",
        });
      });

      // Simulate mousemove stream with rapid points updates
      act(() => {
        for (let i = 1; i <= 10; i++) {
          result.current.updateShape("stroke-move", {
            points: [0, 0, i * 5, i * 5],
          });
        }
      });

      // Before 16ms, final points should not be committed yet
      expect(mockSet).not.toHaveBeenCalledWith("points", [0, 0, 50, 50]);

      // Fast-forward 16ms throttle window
      act(() => {
        jest.advanceTimersByTime(16);
      });

      expect(mockSet).toHaveBeenCalledWith("points", [0, 0, 50, 50]);
    });

    it("immediately flushes buffered points when flushStrokeBuffer is called", () => {
      const { result } = renderHook(() => useCanvasWhiteboard("test-canvas"));

      act(() => {
        result.current.addShape({
          id: "stroke-flush",
          type: "pen",
          points: [5, 5],
          color: "#ffffff",
          width: 3,
          opacity: 1,
          userId: "user-1",
        });
      });

      act(() => {
        result.current.broadcastStroke("stroke-flush", [5, 5, 15, 15, 25, 25]);
        result.current.flushStrokeBuffer?.("stroke-flush");
      });

      expect(mockSet).toHaveBeenCalledWith("points", [5, 5, 15, 15, 25, 25]);
    });
  });
});

