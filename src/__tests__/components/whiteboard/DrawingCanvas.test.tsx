import React from "react";
import { render, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  DrawingCanvas,
  renderShape,
  renderAllShapes,
} from "@/components/whiteboard/DrawingCanvas";
import {
  screenToWorld,
  worldToScreen,
  catmullRomToBezier,
  interpolateCatmullRomPoints,
  drawSmoothSpline,
} from "@/lib/whiteboard/splineCoordinates";
import type { ShapeData } from "@/hooks/useCanvasWhiteboard";

describe("DrawingCanvas & Spline Coordinate Transformations", () => {
  let mockCtx: any;

  beforeAll(() => {
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
    mockCtx = {
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      bezierCurveTo: jest.fn(),
      stroke: jest.fn(),
      strokeRect: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      fillRect: jest.fn(),
      scale: jest.fn(),
      translate: jest.fn(),
      ellipse: jest.fn(),
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

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Spline Coordinates Math", () => {
    it("converts screen to world space using inverse view matrix", () => {
      // Zoom 150% (scale = 1.5), Pan (100, 50)
      const transform = { scale: 1.5, panX: 100, panY: 50 };
      const [worldX, worldY] = screenToWorld(250, 200, transform);

      // (250 - 100) / 1.5 = 100, (200 - 50) / 1.5 = 100
      expect(worldX).toBeCloseTo(100);
      expect(worldY).toBeCloseTo(100);
    });

    it("converts world to screen space using view matrix", () => {
      const transform = { scale: 1.5, panX: 100, panY: 50 };
      const [screenX, screenY] = worldToScreen(100, 100, transform);

      // 100 * 1.5 + 100 = 250, 100 * 1.5 + 50 = 200
      expect(screenX).toBeCloseTo(250);
      expect(screenY).toBeCloseTo(200);
    });

    it("converts 2D coordinate sequences into smooth Catmull-Rom cubic Bezier curves", () => {
      const points = [10, 10, 50, 80, 100, 20, 150, 90];
      const segments = catmullRomToBezier(points);

      // 4 points produce 3 cubic Bezier segments
      expect(segments.length).toBe(3);
      expect(segments[0].endX).toBe(50);
      expect(segments[0].endY).toBe(80);
      expect(segments[1].endX).toBe(100);
      expect(segments[1].endY).toBe(20);
      expect(segments[2].endX).toBe(150);
      expect(segments[2].endY).toBe(90);
    });

    it("interpolates Catmull-Rom intermediate points for sparse remote batches", () => {
      const points = [0, 0, 100, 100];
      const interpolated = interpolateCatmullRomPoints(points, 4);

      // 2 points with 4 subdivisions yields 5 total coordinate pairs (10 numbers)
      expect(interpolated.length).toBe(10);
      expect(interpolated[0]).toBe(0);
      expect(interpolated[1]).toBe(0);
      expect(interpolated[8]).toBe(100);
      expect(interpolated[9]).toBe(100);
    });

    it("draws smooth Catmull-Rom Bezier curves on canvas context", () => {
      const points = [0, 0, 50, 100, 100, 50];
      drawSmoothSpline(mockCtx, points);

      expect(mockCtx.moveTo).toHaveBeenCalledWith(0, 0);
      expect(mockCtx.bezierCurveTo).toHaveBeenCalled();
    });
  });

  describe("Acceptance Criteria 1: Transform pointer events through inverse view matrix before emitting", () => {
    it("normalizes client pointer coordinates to world space at 150% zoom and pan (100, 50)", () => {
      const onAddShape = jest.fn();
      const onCursorMove = jest.fn();
      const onUpdateShape = jest.fn();

      const { getByTestId } = render(
        <DrawingCanvas
          shapeSnapshots={[]}
          tool="pen"
          color="#3b82f6"
          strokeWidth={4}
          onAddShape={onAddShape}
          onUpdateShape={onUpdateShape}
          onCursorMove={onCursorMove}
          userId="peer-1"
          zoom={1.5}
          pan={{ x: 100, y: 50 }}
        />,
      );

      const canvas = getByTestId("drawing-canvas");

      // Pointer down at screen (250, 200) -> world (100, 100)
      act(() => {
        fireEvent.pointerDown(canvas, {
          clientX: 250,
          clientY: 200,
          button: 0,
          pointerId: 1,
        });
      });

      // Pointer move to screen (400, 350) -> world (200, 200)
      act(() => {
        fireEvent.pointerMove(canvas, {
          clientX: 400,
          clientY: 350,
          pointerId: 1,
        });
      });

      expect(onCursorMove).toHaveBeenCalledWith(200, 200);

      // Pointer up
      act(() => {
        fireEvent.pointerUp(canvas, {
          pointerId: 1,
        });
      });

      expect(onAddShape).toHaveBeenCalledTimes(1);
      const addedShape = onAddShape.mock.calls[0][0];

      // Verifies emitted shape points are strictly in normalized world coordinates
      expect(addedShape.points[0]).toBeCloseTo(100);
      expect(addedShape.points[1]).toBeCloseTo(100);
      expect(addedShape.points[2]).toBeCloseTo(200);
      expect(addedShape.points[3]).toBeCloseTo(200);
    });
  });

  describe("Acceptance Criteria 2: Implement spline curve smoothing for incoming remote coordinate batches", () => {
    it("renders remote pen shapes using smooth Catmull-Rom Bezier curves", () => {
      const remoteShape: ShapeData = {
        id: "remote-stroke-1",
        type: "pen",
        color: "#22c55e",
        width: 3,
        opacity: 1,
        userId: "remote-peer-2",
        points: [10, 10, 60, 120, 140, 40, 220, 160],
      };

      renderShape(mockCtx, remoteShape, true);

      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(mockCtx.bezierCurveTo).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });

    it("applies view matrix translation and scaling during renderAllShapes", () => {
      const shapes: ShapeData[] = [
        {
          id: "shape-1",
          type: "rect",
          color: "#ffffff",
          width: 2,
          opacity: 1,
          userId: "user-1",
          points: [50, 50, 150, 150],
        },
      ];

      const transform = { scale: 2.0, panX: 80, panY: 60 };
      renderAllShapes(mockCtx, shapes, 800, 600, transform);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.translate).toHaveBeenCalledWith(80, 60);
      expect(mockCtx.scale).toHaveBeenCalledWith(2.0, 2.0);
      expect(mockCtx.strokeRect).toHaveBeenCalledWith(50, 50, 100, 100);
      expect(mockCtx.restore).toHaveBeenCalled();
    });
  });

  describe("Acceptance Criteria 3: Verify zero visual coordinate drift under varying zoom levels (50% to 300%)", () => {
    const zoomLevels = [0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0];
    const testCoordinates = [
      [0, 0],
      [125.4, 87.6],
      [500, 350],
      [-200, -150],
      [1920, 1080],
    ];

    zoomLevels.forEach((zoom) => {
      it(`verifies zero coordinate drift at ${zoom * 100}% zoom`, () => {
        const pan = { x: 120 * zoom, y: -80 * zoom };
        const transform = { scale: zoom, panX: pan.x, panY: pan.y };

        testCoordinates.forEach(([worldX, worldY]) => {
          const [screenX, screenY] = worldToScreen(worldX, worldY, transform);
          const [roundtripWorldX, roundtripWorldY] = screenToWorld(
            screenX,
            screenY,
            transform,
          );

          expect(roundtripWorldX).toBeCloseTo(worldX, 5);
          expect(roundtripWorldY).toBeCloseTo(worldY, 5);
        });
      });
    });

    it("updates transform on wheel zoom interaction", () => {
      const onViewTransformChange = jest.fn();
      const { getByTestId } = render(
        <DrawingCanvas
          shapeSnapshots={[]}
          tool="pen"
          color="#ffffff"
          strokeWidth={3}
          onAddShape={jest.fn()}
          onUpdateShape={jest.fn()}
          onCursorMove={jest.fn()}
          userId="user-1"
          zoom={1.0}
          onViewTransformChange={onViewTransformChange}
          enableInteractiveZoomPan={true}
        />,
      );

      const canvas = getByTestId("drawing-canvas");

      // Wheel zoom in
      act(() => {
        fireEvent.wheel(canvas, {
          deltaY: -100,
          clientX: 400,
          clientY: 300,
        });
      });

      expect(onViewTransformChange).toHaveBeenCalled();
      const updatedTransform = onViewTransformChange.mock.calls[0][0];
      expect(updatedTransform.scale).toBeGreaterThan(1.0);
      expect(updatedTransform.scale).toBeLessThanOrEqual(3.0);
    });
  });
});
