import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as Y from "yjs";
import {
  generateConstructSvgPath,
  renderConstructSvg,
  renderConstructToCanvas,
  traceConstructPath,
  getConstructBounds,
  hexToRgba,
} from "@/lib/whiteboard/constructGenerator";
import {
  addShapeToDoc,
  updateShapeInDoc,
  shapeMapToData,
  type ShapeData,
} from "@/lib/whiteboard/whiteboardCore";
import { CanvasToolbar } from "@/components/whiteboard/CanvasToolbar";
import { DrawingCanvas } from "@/components/whiteboard/DrawingCanvas";

describe("Construct Generator (#AcceptanceCriteria)", () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      quadraticCurveTo: jest.fn(),
      arc: jest.fn(),
      closePath: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      fillRect: jest.fn(),
      scale: jest.fn(),
      translate: jest.fn(),
      shadowColor: "",
      shadowBlur: 0,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      lineCap: "",
      lineJoin: "",
      globalAlpha: 1,
    };

    HTMLCanvasElement.prototype.getContext = jest.fn(() => mockCtx) as any;
    HTMLCanvasElement.prototype.setPointerCapture = jest.fn();
    HTMLCanvasElement.prototype.releasePointerCapture = jest.fn();
    HTMLCanvasElement.prototype.getBoundingClientRect = jest.fn(
      () =>
        ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => {},
        }) as DOMRect,
    );
  });

  describe("Criteria 1: Parametric SVG / Canvas construct shape generator (shield, hexagon, flight arrow)", () => {
    const bounds = { x: 50, y: 50, width: 200, height: 160 };

    it("generates parametric SVG path for hard-light shield", () => {
      const path = generateConstructSvgPath("shield", bounds);
      expect(path).toContain("M 150 50"); // Apex at (cx, y)
      expect(path).toContain("Q 250 50"); // Curved right top shoulder
      expect(path).toContain("150 210"); // Bottom shield tip at (cx, y + height)
      expect(path).toContain("Z");
    });

    it("generates parametric SVG path for energy matrix hexagon", () => {
      const path = generateConstructSvgPath("hexagon", bounds);
      expect(path.startsWith("M")).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
      // 6 vertices
      const segments = path.split(" ").filter((s) => s === "M" || s === "L");
      expect(segments.length).toBe(6);
    });

    it("generates parametric SVG path for supersonic flight arrow", () => {
      const path = generateConstructSvgPath("flightArrow", bounds);
      expect(path).toContain("M 150 50"); // Forward nose point
      expect(path).toContain("L 250 210"); // Right wing
      expect(path).toContain("L 150"); // Trailing notch
      expect(path).toContain("L 50 210"); // Left wing
      expect(path.endsWith("Z")).toBe(true);
    });

    it("calculates accurate bounding box from drag points", () => {
      const normalBounds = getConstructBounds([100, 80, 300, 240]);
      expect(normalBounds).toEqual({
        x: 100,
        y: 80,
        width: 200,
        height: 160,
      });

      // Inverted drag handles
      const invertedBounds = getConstructBounds([300, 240, 100, 80]);
      expect(invertedBounds).toEqual({
        x: 100,
        y: 80,
        width: 200,
        height: 160,
      });
    });

    it("traces parametric shapes on canvas 2D context", () => {
      traceConstructPath(mockCtx, "shield", bounds);
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalledWith(150, 50);
      expect(mockCtx.quadraticCurveTo).toHaveBeenCalled();
      expect(mockCtx.closePath).toHaveBeenCalled();

      jest.clearAllMocks();
      traceConstructPath(mockCtx, "hexagon", bounds);
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.lineTo).toHaveBeenCalled();
      expect(mockCtx.closePath).toHaveBeenCalled();

      jest.clearAllMocks();
      traceConstructPath(mockCtx, "flightArrow", bounds);
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalledWith(150, 50);
      expect(mockCtx.lineTo).toHaveBeenCalledWith(250, 210);
      expect(mockCtx.closePath).toHaveBeenCalled();
    });

    it("renders complete SVG XML with neon strokes and translucent fill", () => {
      const shape: ShapeData = {
        id: "construct-1",
        type: "construct",
        constructType: "shield",
        points: [50, 50, 250, 210],
        color: "#10b981",
        width: 3,
        opacity: 0.9,
        userId: "user-1",
      };

      const svg = renderConstructSvg(shape);
      expect(svg).toContain('<g opacity="0.9">');
      expect(svg).toContain('fill="rgba(16, 185, 129, 0.22)"');
      expect(svg).toContain('stroke="#10b981"');
      expect(svg).toContain('stroke-width="3"');
      expect(svg).toContain('stroke="rgba(255, 255, 255, 0.6)"');
    });
  });

  describe("Criteria 2: Render shapes with glowing neon strokes and semi-transparent fills", () => {
    it("renders glowing neon stroke with shadowBlur and semi-transparent fill on canvas", () => {
      const shape: ShapeData = {
        id: "construct-2",
        type: "construct",
        constructType: "hexagon",
        points: [100, 100, 300, 300],
        color: "#10b981",
        width: 4,
        opacity: 1,
        userId: "user-1",
      };

      renderConstructToCanvas(mockCtx, shape);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.fillStyle).toBe("rgba(16, 185, 129, 0.22)");
      expect(mockCtx.strokeStyle).toBe("#10b981");
      expect(mockCtx.shadowColor).toBe("#10b981");
      expect(mockCtx.shadowBlur).toBeGreaterThan(0);
      expect(mockCtx.fill).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it("converts hex to translucent RGBA correctly", () => {
      expect(hexToRgba("#10b981", 0.3)).toBe("rgba(16, 185, 129, 0.3)");
      expect(hexToRgba("#3b82f6", 0.5)).toBe("rgba(59, 130, 246, 0.5)");
    });

    it("allows dragging-to-size construct shapes on DrawingCanvas", () => {
      const onAddShape = jest.fn();
      render(
        <DrawingCanvas
          shapeSnapshots={[]}
          tool="construct"
          constructType="flightArrow"
          color="#10b981"
          strokeWidth={3}
          onAddShape={onAddShape}
          onUpdateShape={jest.fn()}
          onCursorMove={jest.fn()}
          userId="user-local"
        />,
      );

      const canvas = screen.getByTestId("drawing-canvas");

      // 1. Pointer Down
      fireEvent(
        canvas,
        new MouseEvent("pointerdown", {
          clientX: 100,
          clientY: 100,
          bubbles: true,
        }),
      );

      // 2. Pointer Move (drag to size)
      fireEvent(
        canvas,
        new MouseEvent("pointermove", {
          clientX: 250,
          clientY: 300,
          bubbles: true,
        }),
      );

      // 3. Pointer Up (commit shape)
      fireEvent(
        canvas,
        new MouseEvent("pointerup", {
          clientX: 250,
          clientY: 300,
          bubbles: true,
        }),
      );

      expect(onAddShape).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "construct",
          constructType: "flightArrow",
          color: "#10b981",
          points: [100, 100, 250, 300],
          userId: "user-local",
        }),
      );
    });
  });

  describe("Criteria 3: Synchronize construct shape coordinates across PartyKit peers in real time", () => {
    it("serializes and deserializes construct shapes in Y.Doc CRDT without data loss", () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();
      const shapes1 = doc1.getArray<Y.Map<unknown>>("shapes");
      const shapes2 = doc2.getArray<Y.Map<unknown>>("shapes");

      // Connect Y.Doc peer updates
      doc1.on("update", (update) => Y.applyUpdate(doc2, update));
      doc2.on("update", (update) => Y.applyUpdate(doc1, update));

      const constructShape: ShapeData = {
        id: "peer-construct-101",
        type: "construct",
        constructType: "shield",
        points: [80, 120, 280, 320],
        color: "#10b981",
        width: 3,
        opacity: 0.85,
        userId: "peer-remote",
      };

      // Add shape to peer 1
      addShapeToDoc(shapes1, doc1, constructShape, "peer-remote");

      // Verify shape synced to peer 2
      expect(shapes2.length).toBe(1);
      const syncedShape = shapeMapToData(shapes2.get(0));
      expect(syncedShape.id).toBe("peer-construct-101");
      expect(syncedShape.type).toBe("construct");
      expect(syncedShape.constructType).toBe("shield");
      expect(syncedShape.points).toEqual([80, 120, 280, 320]);
      expect(syncedShape.color).toBe("#10b981");

      // Update coordinates in peer 2 in real time
      updateShapeInDoc(
        shapes2,
        doc2,
        "peer-construct-101",
        {
          points: [100, 140, 350, 400],
        },
        "peer-remote",
      );

      // Verify updated coordinates synced back to peer 1
      const updatedShape = shapeMapToData(shapes1.get(0));
      expect(updatedShape.points).toEqual([100, 140, 350, 400]);
    });

    it("renders Construct Generator button and subtype selector in CanvasToolbar", () => {
      const onToolChange = jest.fn();
      const onConstructTypeChange = jest.fn();

      const { rerender } = render(
        <CanvasToolbar
          tool="pen"
          color="#10b981"
          strokeWidth={3}
          canUndo={false}
          canRedo={false}
          isConnected={true}
          constructType="shield"
          onToolChange={onToolChange}
          onColorChange={jest.fn()}
          onStrokeWidthChange={jest.fn()}
          onConstructTypeChange={onConstructTypeChange}
          onUndo={jest.fn()}
          onRedo={jest.fn()}
          onClear={jest.fn()}
        />,
      );

      const constructBtn = screen.getByTestId("tool-construct");
      expect(constructBtn).toBeInTheDocument();
      expect(constructBtn).toHaveAttribute("title", "Construct Generator");

      // Switch to construct tool
      fireEvent.click(constructBtn);
      expect(onToolChange).toHaveBeenCalledWith("construct");

      // Rerender with tool="construct"
      rerender(
        <CanvasToolbar
          tool="construct"
          color="#10b981"
          strokeWidth={3}
          canUndo={false}
          canRedo={false}
          isConnected={true}
          constructType="shield"
          onToolChange={onToolChange}
          onColorChange={jest.fn()}
          onStrokeWidthChange={jest.fn()}
          onConstructTypeChange={onConstructTypeChange}
          onUndo={jest.fn()}
          onRedo={jest.fn()}
          onClear={jest.fn()}
        />,
      );

      expect(screen.getByTestId("construct-subtypes-bar")).toBeInTheDocument();
      expect(screen.getByTestId("construct-type-shield")).toBeInTheDocument();
      expect(screen.getByTestId("construct-type-hexagon")).toBeInTheDocument();
      expect(
        screen.getByTestId("construct-type-flightArrow"),
      ).toBeInTheDocument();

      // Click Hexagon
      fireEvent.click(screen.getByTestId("construct-type-hexagon"));
      expect(onConstructTypeChange).toHaveBeenCalledWith("hexagon");

      // Click Flight Arrow
      fireEvent.click(screen.getByTestId("construct-type-flightArrow"));
      expect(onConstructTypeChange).toHaveBeenCalledWith("flightArrow");
    });
  });
});
