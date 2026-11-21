import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as Y from "yjs";
import { CanvasWhiteboard } from "@/components/whiteboard/CanvasWhiteboard";

const mockUseCanvasWhiteboard = jest.fn();

jest.mock("@/hooks/useMeshCanvasWhiteboard", () => ({
  useMeshCanvasWhiteboard: (...args: unknown[]) =>
    mockUseCanvasWhiteboard(...args),
}));

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: {
      id: "test-user-id",
      fullName: "Test User",
      imageUrl: "https://example.com/avatar.png",
    },
  }),
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

const mockGetContext = jest.fn();

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = mockGetContext;
});

describe("CanvasWhiteboard Integration with StateChecksumVerifier", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    jest.clearAllMocks();
    doc = new Y.Doc();

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
  });

  afterEach(() => {
    doc.destroy();
  });

  it("mounts StateChecksumVerifier with live Yjs document", () => {
    mockUseCanvasWhiteboard.mockReturnValue({
      shapeSnapshots: [],
      remoteCursors: [],
      participants: [],
      tool: "pen",
      color: "#ffffff",
      strokeWidth: 3,
      isConnected: true,
      canUndo: false,
      canRedo: false,
      provider: null,
      yDoc: doc,
      setTool: jest.fn(),
      setColor: jest.fn(),
      setStrokeWidth: jest.fn(),
      undo: jest.fn(),
      redo: jest.fn(),
      clearCanvas: jest.fn(),
      addShape: jest.fn(),
      updateShape: jest.fn(),
      acquireNoteLease: jest.fn(),
      releaseNoteLease: jest.fn(),
      noteLeaseOwners: {},
      updateCursor: jest.fn(),
    });

    render(<CanvasWhiteboard canvasId="integration-canvas-101" />);

    // CanvasToolbar should render
    expect(screen.getByTitle("Pen")).toBeInTheDocument();

    // Checksum modal should initially not be visible since no mismatch has occurred
    expect(screen.queryByRole("dialog", { name: /State Synchronization Issue Detected/i })).not.toBeInTheDocument();
  });
});
