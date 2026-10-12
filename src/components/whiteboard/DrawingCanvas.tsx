"use client";

import { useCallback, useEffect, useRef, useMemo } from "react";
import type { ShapeData, ToolType } from "@/hooks/useCanvasWhiteboard";
import {
  type CanvasViewTransform,
  DEFAULT_VIEW_TRANSFORM,
  screenToWorld,
  drawSmoothSpline,
} from "@/lib/whiteboard/splineCoordinates";

export {
  type CanvasViewTransform,
  DEFAULT_VIEW_TRANSFORM,
  screenToWorld,
  worldToScreen,
  catmullRomToBezier,
  drawSmoothSpline,
  interpolateCatmullRomPoints,
} from "@/lib/whiteboard/splineCoordinates";

export interface DrawingCanvasProps {
  shapeSnapshots: ShapeData[];
  tool: ToolType;
  color: string;
  strokeWidth: number;
  onAddShape: (shape: ShapeData) => void;
  onUpdateShape: (id: string, updates: Partial<ShapeData>) => void;
  onCursorMove: (x: number, y: number) => void;
  userId: string;
  /** Current zoom level (e.g. 0.5 to 3.0, representing 50% to 300%) */
  zoom?: number;
  /** Pan translation offset in pixels */
  pan?: { x: number; y: number };
  /** Complete view matrix transform */
  viewTransform?: CanvasViewTransform;
  /** Callback fired when user interactively pans or zooms */
  onViewTransformChange?: (transform: CanvasViewTransform) => void;
  /** Enable interactive wheel zooming and space+drag canvas panning */
  enableInteractiveZoomPan?: boolean;
  /** Enable Catmull-Rom spline curve smoothing for pencil/eraser strokes (default: true) */
  smoothSplines?: boolean;
}

export function renderShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeData,
  smooth = true,
) {
  if (shape.points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = shape.type === "eraser" ? "#1a1a2e" : shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = shape.opacity;

  if (shape.type === "pen" || shape.type === "eraser") {
    ctx.beginPath();
    if (smooth) {
      drawSmoothSpline(ctx, shape.points);
    } else {
      ctx.moveTo(shape.points[0], shape.points[1]);
      for (let i = 2; i < shape.points.length; i += 2) {
        ctx.lineTo(shape.points[i], shape.points[i + 1]);
      }
    }
    ctx.stroke();
  } else if (shape.type === "line") {
    ctx.beginPath();
    ctx.moveTo(shape.points[0], shape.points[1]);
    ctx.lineTo(shape.points[2], shape.points[3]);
    ctx.stroke();
  } else if (shape.type === "rect") {
    const x = shape.points[0];
    const y = shape.points[1];
    const w = shape.points[2] - x;
    const h = shape.points[3] - y;
    ctx.strokeRect(x, y, w, h);
  } else if (shape.type === "circle") {
    const cx = shape.points[0];
    const cy = shape.points[1];
    const ex = shape.points.length >= 4 ? shape.points[2] : cx;
    const ey = shape.points.length >= 4 ? shape.points[3] : cy;
    const rx = Math.abs(ex - cx);
    const ry = Math.abs(ey - cy);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx || 1, ry || 1, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

export function renderAllShapes(
  ctx: CanvasRenderingContext2D,
  shapes: ShapeData[],
  width: number,
  height: number,
  transform: CanvasViewTransform = DEFAULT_VIEW_TRANSFORM,
  pendingShape: ShapeData | null = null,
  smooth = true,
) {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, width, height);

  // Apply view matrix: translate then scale world space into screen space
  ctx.save();
  if (typeof ctx.translate === "function") {
    ctx.translate(transform.panX, transform.panY);
  }
  if (typeof ctx.scale === "function") {
    ctx.scale(transform.scale, transform.scale);
  }

  for (const shape of shapes) {
    renderShape(ctx, shape, smooth);
  }

  if (pendingShape) {
    renderShape(ctx, pendingShape, smooth);
  }

  ctx.restore();
}

export function DrawingCanvas({
  shapeSnapshots,
  tool,
  color,
  strokeWidth,
  onAddShape,
  onUpdateShape,
  onCursorMove,
  userId,
  zoom,
  pan,
  viewTransform,
  onViewTransformChange,
  enableInteractiveZoomPan = true,
  smoothSplines = true,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isSpaceHeldRef = useRef(false);
  const panStartRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });

  const currentIdRef = useRef<string | null>(null);
  const currentPointsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const shapeSnapshotsRef = useRef(shapeSnapshots);
  const pendingShapeRef = useRef<ShapeData | null>(null);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const strokeWidthRef = useRef(strokeWidth);
  const onAddShapeRef = useRef(onAddShape);
  const onUpdateShapeRef = useRef(onUpdateShape);
  const onViewTransformChangeRef = useRef(onViewTransformChange);

  // Determine current active view transform
  const activeTransform: CanvasViewTransform = useMemo(() => {
    if (viewTransform) {
      return {
        scale:
          Number.isFinite(viewTransform.scale) && viewTransform.scale > 0
            ? viewTransform.scale
            : 1.0,
        panX: Number.isFinite(viewTransform.panX) ? viewTransform.panX : 0,
        panY: Number.isFinite(viewTransform.panY) ? viewTransform.panY : 0,
      };
    }
    const scale =
      zoom !== undefined && Number.isFinite(zoom) && zoom > 0 ? zoom : 1.0;
    const panX = pan?.x !== undefined && Number.isFinite(pan.x) ? pan.x : 0;
    const panY = pan?.y !== undefined && Number.isFinite(pan.y) ? pan.y : 0;
    return { scale, panX, panY };
  }, [viewTransform, zoom, pan]);

  const transformRef = useRef<CanvasViewTransform>(activeTransform);
  useEffect(() => {
    transformRef.current = activeTransform;
  }, [activeTransform]);

  useEffect(() => {
    shapeSnapshotsRef.current = shapeSnapshots;
  }, [shapeSnapshots]);

  useEffect(() => {
    toolRef.current = tool;
    colorRef.current = color;
    strokeWidthRef.current = strokeWidth;
    onAddShapeRef.current = onAddShape;
    onUpdateShapeRef.current = onUpdateShape;
    onViewTransformChangeRef.current = onViewTransformChange;
  }, [
    tool,
    color,
    strokeWidth,
    onAddShape,
    onUpdateShape,
    onViewTransformChange,
  ]);

  /**
   * AC 1: Transforms raw screen client coordinates through the inverse
   * canvas view matrix into normalized world space coordinates.
   */
  const getCanvasPos = useCallback(
    (clientX?: number, clientY?: number): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      const cx =
        typeof clientX === "number" && Number.isFinite(clientX) ? clientX : 0;
      const cy =
        typeof clientY === "number" && Number.isFinite(clientY) ? clientY : 0;
      const left = rect && typeof rect.left === "number" ? rect.left : 0;
      const top = rect && typeof rect.top === "number" ? rect.top : 0;
      const screenX = cx - left;
      const screenY = cy - top;
      return screenToWorld(screenX, screenY, transformRef.current);
    },
    [],
  );

  // Interactive Space bar panning listener
  useEffect(() => {
    if (!enableInteractiveZoomPan) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        isSpaceHeldRef.current = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpaceHeldRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [enableInteractiveZoomPan]);

  // Main rendering animation loop
  useEffect(() => {
    const loop = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        if (typeof ctx.scale === "function") {
          ctx.scale(dpr, dpr);
        }
      }

      renderAllShapes(
        ctx,
        shapeSnapshotsRef.current,
        w,
        h,
        transformRef.current,
        pendingShapeRef.current,
        smoothSplines,
      );

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [smoothSplines]);

  // Pointer Down handler
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Middle button or Space+Click initiates canvas panning
      if (
        enableInteractiveZoomPan &&
        (e.button === 1 || isSpaceHeldRef.current)
      ) {
        e.preventDefault();
        isPanningRef.current = true;
        canvas.setPointerCapture(e.pointerId);
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: transformRef.current.panX,
          panY: transformRef.current.panY,
        };
        return;
      }

      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);

      // Normalized world coordinates
      const [worldX, worldY] = getCanvasPos(e.clientX, e.clientY);

      isDrawingRef.current = true;
      currentPointsRef.current = [worldX, worldY];
      const id = `stroke-${Date.now()}-${userId}-${Math.random().toString(36).slice(2, 8)}`;
      currentIdRef.current = id;

      pendingShapeRef.current = {
        id,
        type: toolRef.current,
        points:
          toolRef.current === "sticky"
            ? [worldX, worldY, worldX + 220, worldY + 160]
            : [worldX, worldY],
        color: colorRef.current,
        width: strokeWidthRef.current,
        opacity: 1,
        userId,
        text:
          toolRef.current === "sticky"
            ? "## New note\n\nWrite here..."
            : undefined,
      };
    },
    [enableInteractiveZoomPan, getCanvasPos, userId],
  );

  // Pointer Move handler
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Panning update
      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        const newTransform: CanvasViewTransform = {
          ...transformRef.current,
          panX: panStartRef.current.panX + dx,
          panY: panStartRef.current.panY + dy,
        };
        transformRef.current = newTransform;
        onViewTransformChangeRef.current?.(newTransform);
        return;
      }

      // World coordinates for cursor broadcasting & drawing
      const [worldX, worldY] = getCanvasPos(e.clientX, e.clientY);
      onCursorMove(worldX, worldY);

      if (!isDrawingRef.current || !currentIdRef.current) return;

      currentPointsRef.current.push(worldX, worldY);

      const p = pendingShapeRef.current;
      if (p) {
        if (p.type === "pen" || p.type === "eraser") {
          p.points = currentPointsRef.current.slice();
        } else if (
          p.type === "line" ||
          p.type === "rect" ||
          p.type === "circle" ||
          p.type === "sticky"
        ) {
          const [sx, sy] = [
            currentPointsRef.current[0],
            currentPointsRef.current[1],
          ];
          p.points = [sx, sy, worldX, worldY];
        }
      }
    },
    [getCanvasPos, onCursorMove],
  );

  // Pointer Up handler
  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas) canvas.releasePointerCapture(e.pointerId);

      if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
      }

      if (!isDrawingRef.current || !currentIdRef.current) return;

      const points = currentPointsRef.current;
      const id = currentIdRef.current;
      const finalType = toolRef.current;

      if (points.length >= 2) {
        const shape: ShapeData = {
          id,
          type: finalType,
          color: colorRef.current,
          width: strokeWidthRef.current,
          opacity: 1,
          points: points.slice(),
          userId,
          text: pendingShapeRef.current?.text,
        };

        if (
          finalType === "line" ||
          finalType === "rect" ||
          finalType === "circle"
        ) {
          shape.points = [
            points[0],
            points[1],
            points[points.length - 2],
            points[points.length - 1],
          ];
        }

        onAddShapeRef.current(shape);
      }

      isDrawingRef.current = false;
      currentIdRef.current = null;
      currentPointsRef.current = [];
      pendingShapeRef.current = null;
    },
    [userId],
  );

  // Mouse wheel zoom handler
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!enableInteractiveZoomPan) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const oldScale = transformRef.current.scale;
      const delta = -e.deltaY * 0.0015;
      const newScale = Math.max(0.5, Math.min(3.0, oldScale * (1 + delta)));

      // Zoom centered on cursor position
      const newPanX =
        cursorX - (cursorX - transformRef.current.panX) * (newScale / oldScale);
      const newPanY =
        cursorY - (cursorY - transformRef.current.panY) * (newScale / oldScale);

      const updatedTransform: CanvasViewTransform = {
        scale: Math.round(newScale * 1000) / 1000,
        panX: Math.round(newPanX * 10) / 10,
        panY: Math.round(newPanY * 10) / 10,
      };

      transformRef.current = updatedTransform;
      onViewTransformChangeRef.current?.(updatedTransform);
    },
    [enableInteractiveZoomPan],
  );

  return (
    <canvas
      ref={canvasRef}
      data-testid="drawing-canvas"
      data-zoom={activeTransform.scale}
      data-pan-x={activeTransform.panX}
      data-pan-y={activeTransform.panY}
      className="absolute inset-0 touch-none cursor-crosshair"
      style={{ width: "100%", height: "100%" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    />
  );
}
