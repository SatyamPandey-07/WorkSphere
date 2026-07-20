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
  observe = mockObserve;
  unobserve = mockUnobserve;
  push = mockPush;
  delete = mockDelete;
  get = mockGet;
  toArray = mockToArray;
  get length() {
    return mockLength;
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
  class YArray {
    observe = mockObserve;
    unobserve = mockUnobserve;
    push = mockPush;
    delete = mockDelete;
    get = mockGet;
    toArray = mockToArray;
    get length() {
      return mockLength;
    }
    map = jest.fn();
  }

  return {
    Doc: jest.fn().mockImplementation(() => ({
      getArray: jest.fn().mockReturnValue(mockYArrayInstance),
      destroy: mockDestroy,
      on: jest.fn(),
    })),
    Array: YArray,
    Map: jest.fn().mockImplementation(() => ({
      get: mockGet,
      set: mockSet,
    })),
    UndoManager: jest.fn().mockImplementation(() => mockUndoManager),
  };
});

jest.mock("y-partykit/provider", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    awareness: mockAwareness,
    disconnect: mockDisconnect,
    on: jest.fn(),
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
});
