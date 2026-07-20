import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CanvasWhiteboard } from "@/components/whiteboard/CanvasWhiteboard";

const mockUseCanvasWhiteboard = jest.fn();

jest.mock("@/hooks/useCanvasWhiteboard", () => ({
  useCanvasWhiteboard: (...args: unknown[]) => mockUseCanvasWhiteboard(...args),
}));

const mockGetContext = jest.fn();

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = mockGetContext;
});

beforeEach(() => {
  jest.clearAllMocks();

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

    const colorButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.title?.startsWith("#"));
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
});
