import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultCanvasToolbar, {
  CanvasToolbar,
  TOOLS,
  type CanvasToolbarProps,
} from "@/components/whiteboard/CanvasToolbar";
import type { WhiteboardParticipant } from "@/hooks/useCanvasWhiteboard";

describe("CanvasToolbar Component", () => {
  const defaultProps: CanvasToolbarProps = {
    tool: "pen",
    color: "#ffffff",
    strokeWidth: 3,
    canUndo: true,
    canRedo: false,
    isConnected: true,
    onToolChange: jest.fn(),
    onColorChange: jest.fn(),
    onStrokeWidthChange: jest.fn(),
    onUndo: jest.fn(),
    onRedo: jest.fn(),
    onClear: jest.fn(),
    onOpenShortcuts: jest.fn(),
    onExportPNG: jest.fn(),
    onExportSVG: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports named and default components identically and exposes TOOLS constant", () => {
    expect(CanvasToolbar).toBeDefined();
    expect(DefaultCanvasToolbar).toBe(CanvasToolbar);
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS.length).toBe(7);
  });

  it("renders all drawing tool buttons and triggers onToolChange", () => {
    render(<CanvasToolbar {...defaultProps} />);

    expect(screen.getByTestId("tool-pen")).toBeInTheDocument();
    expect(screen.getByTestId("tool-eraser")).toBeInTheDocument();
    expect(screen.getByTestId("tool-rect")).toBeInTheDocument();
    expect(screen.getByTestId("tool-circle")).toBeInTheDocument();
    expect(screen.getByTestId("tool-line")).toBeInTheDocument();
    expect(screen.getByTestId("tool-construct")).toBeInTheDocument();
    expect(screen.getByTestId("tool-sticky")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tool-eraser"));
    expect(defaultProps.onToolChange).toHaveBeenCalledWith("eraser");

    // Switching to construct sets green construct color
    fireEvent.click(screen.getByTestId("tool-construct"));
    expect(defaultProps.onToolChange).toHaveBeenCalledWith("construct");
    expect(defaultProps.onColorChange).toHaveBeenCalledWith("#00FF88");
  });

  it("renders construct subtypes when tool is construct and triggers onConstructTypeChange", () => {
    const onConstructTypeChange = jest.fn();
    render(
      <CanvasToolbar
        {...defaultProps}
        tool="construct"
        constructType="shield"
        onConstructTypeChange={onConstructTypeChange}
      />
    );

    expect(screen.getByTestId("construct-subtypes-bar")).toBeInTheDocument();
    expect(screen.getByTestId("construct-type-shield")).toBeInTheDocument();
    expect(screen.getByTestId("construct-type-hexagon")).toBeInTheDocument();
    expect(screen.getByTestId("construct-type-flightArrow")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("construct-type-hexagon"));
    expect(onConstructTypeChange).toHaveBeenCalledWith("hexagon");

    fireEvent.click(screen.getByTestId("construct-type-flightArrow"));
    expect(onConstructTypeChange).toHaveBeenCalledWith("flightArrow");
  });

  it("renders stroke width slider and triggers onStrokeWidthChange", () => {
    render(<CanvasToolbar {...defaultProps} strokeWidth={5} />);

    expect(screen.getByText("5")).toBeInTheDocument();
    const slider = screen.getByTestId("whiteboard-stroke-width-slider");
    expect(slider).toHaveValue("5");

    fireEvent.change(slider, { target: { value: "12" } });
    expect(defaultProps.onStrokeWidthChange).toHaveBeenCalledWith(12);
  });

  it("handles history actions (undo, redo, clear) with correct disable states", () => {
    render(
      <CanvasToolbar
        {...defaultProps}
        canUndo={true}
        canRedo={false}
      />
    );

    const undoBtn = screen.getByTestId("whiteboard-undo-btn");
    const redoBtn = screen.getByTestId("whiteboard-redo-btn");
    const clearBtn = screen.getByTestId("whiteboard-clear-btn");

    expect(undoBtn).not.toBeDisabled();
    expect(redoBtn).toBeDisabled();

    fireEvent.click(undoBtn);
    expect(defaultProps.onUndo).toHaveBeenCalledTimes(1);

    fireEvent.click(redoBtn);
    expect(defaultProps.onRedo).not.toHaveBeenCalled();

    fireEvent.click(clearBtn);
    expect(defaultProps.onClear).toHaveBeenCalledTimes(1);
  });

  it("supports PNG and SVG export actions with configurable DPI", () => {
    render(<CanvasToolbar {...defaultProps} />);

    const select = screen.getByTestId("export-dpi-select");
    expect(select).toHaveValue("2");

    fireEvent.change(select, { target: { value: "4" } });
    expect(select).toHaveValue("4");

    const pngBtn = screen.getByTestId("export-png-btn");
    fireEvent.click(pngBtn);
    expect(defaultProps.onExportPNG).toHaveBeenCalledWith(4);

    const svgBtn = screen.getByTestId("export-svg-btn");
    fireEvent.click(svgBtn);
    expect(defaultProps.onExportSVG).toHaveBeenCalledTimes(1);
  });

  it("renders shortcuts button and triggers onOpenShortcuts", () => {
    render(<CanvasToolbar {...defaultProps} />);

    const shortcutsBtn = screen.getByTestId("whiteboard-shortcuts-btn");
    fireEvent.click(shortcutsBtn);
    expect(defaultProps.onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it("renders participants with active and idle indicators", () => {
    const mockParticipants: WhiteboardParticipant[] = [
      {
        clientId: "client-1",
        name: "Alice",
        color: "#ff0055",
        status: "active",
        lastActiveAt: Date.now(),
      },
      {
        clientId: "client-2",
        name: "Bob",
        color: "#00aaff",
        status: "idle",
        lastActiveAt: Date.now() - 50000,
      },
    ];

    render(<CanvasToolbar {...defaultProps} participants={mockParticipants} />);

    expect(screen.getByTestId("whiteboard-participants")).toBeInTheDocument();
    expect(screen.getByTestId("participant-client-1")).toBeInTheDocument();
    expect(screen.getByTestId("participant-client-2")).toBeInTheDocument();
    expect(screen.getByTestId("idle-badge-client-2")).toBeInTheDocument();
    expect(screen.queryByTestId("idle-badge-client-1")).not.toBeInTheDocument();
  });

  it("displays correct connection status text and indicator", () => {
    const { rerender } = render(<CanvasToolbar {...defaultProps} isConnected={true} />);

    const statusContainer = screen.getByTestId("whiteboard-connection-status");
    expect(statusContainer).toHaveTextContent("Connected");

    rerender(<CanvasToolbar {...defaultProps} isConnected={false} />);
    expect(statusContainer).toHaveTextContent("Connecting...");
  });

  it("merges custom className and data-testid via cn utility", () => {
    render(
      <CanvasToolbar
        {...defaultProps}
        className="custom-whiteboard-toolbar border border-white"
        data-testid="custom-toolbar-root"
      />
    );

    const root = screen.getByTestId("custom-toolbar-root");
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass("custom-whiteboard-toolbar");
    expect(root).toHaveClass("border-white");
  });
});
