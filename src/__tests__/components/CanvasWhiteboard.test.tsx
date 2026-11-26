import { act, render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CanvasWhiteboard } from "@/components/whiteboard/CanvasWhiteboard";

const mockUseCanvasWhiteboard = jest.fn();
const mockUseUser = jest.fn();

jest.mock("@/hooks/useMeshCanvasWhiteboard", () => ({
  useMeshCanvasWhiteboard: (...args: unknown[]) =>
    mockUseCanvasWhiteboard(...args),
}));

jest.mock("@clerk/nextjs", () => ({
  useUser: () => mockUseUser(),
}));

const mockGetContext = jest.fn();

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = mockGetContext;
  if (typeof window.PointerEvent === "undefined") {
    class MockPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: any = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
      }
    }
    window.PointerEvent = MockPointerEvent as any;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUser.mockReturnValue({
    user: null,
    isLoaded: true,
    isSignedIn: false,
  });

  mockGetContext.mockReturnValue({
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    strokeRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    fill: jest.fn(),
    arc: jest.fn(),
    closePath: jest.fn(),
    setLineDash: jest.fn(),
    measureText: jest.fn().mockReturnValue({ width: 10 }),
    fillText: jest.fn(),
    createLinearGradient: jest
      .fn()
      .mockReturnValue({ addColorStop: jest.fn() }),
    scale: jest.fn(),
    ellipse: jest.fn(),
  });

  mockUseCanvasWhiteboard.mockReturnValue({
    shapeSnapshots: [],
    remoteCursors: [],
    tool: "pen",
    color: "#ffffff",
    strokeWidth: 3,
    isConnected: false,
    canUndo: false,
    canRedo: false,
    provider: null,
    yDoc: null,
    shapes: { observe: jest.fn(), toArray: () => [] },
    setTool: jest.fn(),
    setColor: jest.fn(),
    setStrokeWidth: jest.fn(),
    undo: jest.fn(),
    redo: jest.fn(),
    clearCanvas: jest.fn(),
    addShape: jest.fn(),
    updateShape: jest.fn(),
    updateCursor: jest.fn(),
  });
});

describe("CanvasWhiteboard", () => {
  it("renders toolbar with all tools", () => {
    render(<CanvasWhiteboard canvasId="test-1" />);

    expect(screen.getByTitle("Pen")).toBeInTheDocument();
    expect(screen.getByTitle("Eraser")).toBeInTheDocument();
    expect(screen.getByTitle("Rectangle")).toBeInTheDocument();
    expect(screen.getByTitle("Circle")).toBeInTheDocument();
    expect(screen.getByTitle("Line")).toBeInTheDocument();
  });

  it("renders canvas element", () => {
    const { container } = render(<CanvasWhiteboard canvasId="test-2" />);
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
  });

  it("shows the expiration banner for an unauthenticated read-only guest session", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));

    render(
      <CanvasWhiteboard
        canvasId="guest-session"
        readOnlyGuestSession={{ expiresAtMs: 65_000 }}
      />,
    );

    expect(
      screen.getByRole("complementary", {
        name: "Read-only guest session expiration",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 minute, 5 seconds")).toBeInTheDocument();

    jest.useRealTimers();
  });

  it("updates the countdown as the guest session approaches expiration", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));

    render(
      <CanvasWhiteboard
        canvasId="guest-countdown"
        readOnlyGuestSession={{ expiresAtMs: 65_000 }}
      />,
    );
    expect(screen.getByText("1 minute, 5 seconds")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("1 minute, 4 seconds")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("shows an expired status at zero and stops the countdown timer", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));

    render(
      <CanvasWhiteboard
        canvasId="guest-expired"
        readOnlyGuestSession={{ expiresAtMs: 1000 }}
      />,
    );
    expect(screen.getByText("1 second")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Guest session expired");
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it("does not show the banner for authenticated or non-guest sessions", () => {
    mockUseUser.mockReturnValue({
      user: { id: "signed-in-user" },
      isLoaded: true,
      isSignedIn: true,
    });
    const { rerender } = render(
      <CanvasWhiteboard
        canvasId="authenticated-session"
        readOnlyGuestSession={{ expiresAtMs: Date.now() + 60_000 }}
      />,
    );
    expect(
      screen.queryByRole("complementary", {
        name: "Read-only guest session expiration",
      }),
    ).not.toBeInTheDocument();

    mockUseUser.mockReturnValue({
      user: null,
      isLoaded: true,
      isSignedIn: false,
    });
    rerender(<CanvasWhiteboard canvasId="ordinary-session" />);
    expect(
      screen.queryByRole("complementary", {
        name: "Read-only guest session expiration",
      }),
    ).not.toBeInTheDocument();
  });

  it("omits the banner when the guest expiry timestamp is missing or invalid", () => {
    const { rerender } = render(
      <CanvasWhiteboard
        canvasId="guest-missing-expiry"
        readOnlyGuestSession={{}}
      />,
    );

    for (const readOnlyGuestSession of [
      null,
      {},
      { expiresAtMs: null },
      { expiresAtMs: NaN },
      { expiresAtMs: Infinity },
      { expiresAtMs: Number.MAX_VALUE },
    ]) {
      rerender(
        <CanvasWhiteboard
          canvasId="guest-invalid-expiry"
          readOnlyGuestSession={readOnlyGuestSession}
        />,
      );
      expect(
        screen.queryByRole("complementary", {
          name: "Read-only guest session expiration",
        }),
      ).not.toBeInTheDocument();
    }
  });

  it("cleans up the countdown interval when the whiteboard unmounts", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");

    const { unmount } = render(
      <CanvasWhiteboard
        canvasId="guest-cleanup"
        readOnlyGuestSession={{ expiresAtMs: 5000 }}
      />,
    );
    expect(jest.getTimerCount()).toBe(1);

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    clearIntervalSpy.mockRestore();
    jest.useRealTimers();
  });

  it("calls setTool when a tool button is clicked", () => {
    const mockSetTool = jest.fn();
    mockUseCanvasWhiteboard.mockReturnValue({
      shapeSnapshots: [],
      remoteCursors: [],
      tool: "pen",
      color: "#ffffff",
      strokeWidth: 3,
      isConnected: false,
      canUndo: false,
      canRedo: false,
      provider: null,
      yDoc: null,
      shapes: { observe: jest.fn(), toArray: () => [] },
      setTool: mockSetTool,
      setColor: jest.fn(),
      setStrokeWidth: jest.fn(),
      undo: jest.fn(),
      redo: jest.fn(),
      clearCanvas: jest.fn(),
      addShape: jest.fn(),
      updateShape: jest.fn(),
      updateCursor: jest.fn(),
    });

    render(<CanvasWhiteboard canvasId="test-3" />);

    fireEvent.click(screen.getByTitle("Rectangle"));
    expect(mockSetTool).toHaveBeenCalledWith("rect");

    fireEvent.click(screen.getByTitle("Circle"));
    expect(mockSetTool).toHaveBeenCalledWith("circle");
  });

  it("renders color presets", () => {
    render(<CanvasWhiteboard canvasId="test-4" />);

    const colorButtons = screen.getAllByRole("radio");
    expect(colorButtons.length).toBe(8);
  });

  it("renders undo, redo, and clear buttons", () => {
    render(<CanvasWhiteboard canvasId="test-5" />);

    expect(screen.getByTitle("Undo")).toBeInTheDocument();
    expect(screen.getByTitle("Redo")).toBeInTheDocument();
    expect(screen.getByTitle("Clear canvas")).toBeInTheDocument();
  });

  it("calls undo when undo button clicked", () => {
    const mockUndo = jest.fn();
    mockUseCanvasWhiteboard.mockReturnValue({
      shapeSnapshots: [],
      remoteCursors: [],
      tool: "pen",
      color: "#ffffff",
      strokeWidth: 3,
      isConnected: false,
      canUndo: true,
      canRedo: false,
      provider: null,
      yDoc: null,
      shapes: { observe: jest.fn(), toArray: () => [] },
      setTool: jest.fn(),
      setColor: jest.fn(),
      setStrokeWidth: jest.fn(),
      undo: mockUndo,
      redo: jest.fn(),
      clearCanvas: jest.fn(),
      addShape: jest.fn(),
      updateShape: jest.fn(),
      updateCursor: jest.fn(),
    });

    render(<CanvasWhiteboard canvasId="test-6" />);

    fireEvent.click(screen.getByTitle("Undo"));
    expect(mockUndo).toHaveBeenCalledTimes(1);
  });

  it("calls clearCanvas when clear button clicked", () => {
    const mockClear = jest.fn();
    mockUseCanvasWhiteboard.mockReturnValue({
      shapeSnapshots: [],
      remoteCursors: [],
      tool: "pen",
      color: "#ffffff",
      strokeWidth: 3,
      isConnected: false,
      canUndo: false,
      canRedo: false,
      provider: null,
      yDoc: null,
      shapes: { observe: jest.fn(), toArray: () => [] },
      setTool: jest.fn(),
      setColor: jest.fn(),
      setStrokeWidth: jest.fn(),
      undo: jest.fn(),
      redo: jest.fn(),
      clearCanvas: mockClear,
      addShape: jest.fn(),
      updateShape: jest.fn(),
      updateCursor: jest.fn(),
    });

    render(<CanvasWhiteboard canvasId="test-7" />);

    fireEvent.click(screen.getByTitle("Clear canvas"));
    expect(mockClear).toHaveBeenCalled();
  });

  describe("Pointer coordinates batching & throttling", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("throttles rapid pointermove events to 30ms intervals to prevent UI freezing", () => {
      const mockUpdateCursor = jest.fn();
      mockUseCanvasWhiteboard.mockReturnValue({
        shapeSnapshots: [],
        remoteCursors: [],
        tool: "pen",
        color: "#ffffff",
        strokeWidth: 3,
        isConnected: true,
        canUndo: false,
        canRedo: false,
        provider: null,
        yDoc: null,
        shapes: { observe: jest.fn(), toArray: () => [] },
        setTool: jest.fn(),
        setColor: jest.fn(),
        setStrokeWidth: jest.fn(),
        undo: jest.fn(),
        redo: jest.fn(),
        clearCanvas: jest.fn(),
        addShape: jest.fn(),
        updateShape: jest.fn(),
        updateCursor: mockUpdateCursor,
      });

      const { container } = render(
        <CanvasWhiteboard canvasId="test-throttle" />,
      );
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();

      // First pointermove: leading edge invokes updateCursor immediately
      fireEvent.pointerMove(canvas!, { clientX: 100, clientY: 100 });
      expect(mockUpdateCursor).toHaveBeenCalledTimes(1);
      expect(mockUpdateCursor).toHaveBeenLastCalledWith(100, 100);

      // Rapid consecutive pointermove events within the 30ms window
      fireEvent.pointerMove(canvas!, { clientX: 110, clientY: 110 });
      fireEvent.pointerMove(canvas!, { clientX: 120, clientY: 120 });
      fireEvent.pointerMove(canvas!, { clientX: 130, clientY: 130 });

      // Should NOT have triggered additional immediate dispatches
      expect(mockUpdateCursor).toHaveBeenCalledTimes(1);

      // Advance timers by 35ms to allow the 30ms trailing throttle timer to flush
      jest.advanceTimersByTime(35);

      // Trailing edge invokes updateCursor with the latest buffered position (130, 130)
      expect(mockUpdateCursor).toHaveBeenCalledTimes(2);
      expect(mockUpdateCursor).toHaveBeenLastCalledWith(130, 130);
    });
  });
});
