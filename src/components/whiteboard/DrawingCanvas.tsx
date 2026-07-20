"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ShapeData, ToolType } from "@/hooks/useCanvasWhiteboard";

interface DrawingCanvasProps {
  shapeSnapshots: ShapeData[];
  tool: ToolType;
  color: string;
  strokeWidth: number;
  onAddShape: (shape: ShapeData) => void;
  onUpdateShape: (id: string, updates: Partial<ShapeData>) => void;
  onCursorMove: (x: number, y: number) => void;
  userId: string;
}

function renderShape(ctx: CanvasRenderingContext2D, shape: ShapeData) {
  if (shape.points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = shape.type === "eraser" ? "#1a1a2e" : shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = shape.opacity;

  if (shape.type === "pen" || shape.type === "eraser") {
    ctx.beginPath();
    ctx.moveTo(shape.points[0], shape.points[1]);
    for (let i = 2; i < shape.points.length; i += 2) {
      ctx.lineTo(shape.points[i], shape.points[i + 1]);
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

function renderAllShapes(
  ctx: CanvasRenderingContext2D,
  shapes: ShapeData[],
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, width, height);

  for (const shape of shapes) {
    renderShape(ctx, shape);
  }
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
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
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

  useEffect(() => {
    shapeSnapshotsRef.current = shapeSnapshots;
  }, [shapeSnapshots]);

  useEffect(() => {
    toolRef.current = tool;
    colorRef.current = color;
    strokeWidthRef.current = strokeWidth;
    onAddShapeRef.current = onAddShape;
    onUpdateShapeRef.current = onUpdateShape;
  }, [tool, color, strokeWidth, onAddShape, onUpdateShape]);

  const getCanvasPos = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      return [clientX - rect.left, clientY - rect.top];
    },
    [],
  );

  useEffect(() => {
    const loop = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.scale(dpr, dpr);
      }

      renderAllShapes(ctx, shapeSnapshotsRef.current, w, h);

      if (pendingShapeRef.current) {
        renderShape(ctx, pendingShapeRef.current);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);

      const [x, y] = getCanvasPos(e.clientX, e.clientY);

      isDrawingRef.current = true;
      currentPointsRef.current = [x, y];
      const id = `stroke-${Date.now()}-${userId}-${Math.random().toString(36).slice(2, 8)}`;
      currentIdRef.current = id;

      pendingShapeRef.current = {
        id,
        type: toolRef.current,
        points: [x, y],
        color: colorRef.current,
        width: strokeWidthRef.current,
        opacity: 1,
        userId,
      };
    },
    [getCanvasPos, userId],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const [x, y] = getCanvasPos(e.clientX, e.clientY);
      onCursorMove(x, y);

      if (!isDrawingRef.current || !currentIdRef.current) return;

      currentPointsRef.current.push(x, y);

      const p = pendingShapeRef.current;
      if (p) {
        if (p.type === "pen" || p.type === "eraser") {
          p.points = currentPointsRef.current.slice();
        } else if (
          p.type === "line" ||
          p.type === "rect" ||
          p.type === "circle"
        ) {
          const [sx, sy] = [
            currentPointsRef.current[0],
            currentPointsRef.current[1],
          ];
          p.points = [sx, sy, x, y];
        }
      }
    },
    [getCanvasPos, onCursorMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || !currentIdRef.current) return;

      const canvas = canvasRef.current;
      if (canvas) canvas.releasePointerCapture(e.pointerId);

      const points = currentPointsRef.current;
      const id = currentIdRef.current;
      const finalType = toolRef.current;

      if (points.length >= 4) {
        const shape: ShapeData = {
          id,
          type: finalType,
          color: colorRef.current,
          width: strokeWidthRef.current,
          opacity: 1,
          points: points.slice(),
          userId,
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

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 touch-none cursor-crosshair"
      style={{ width: "100%", height: "100%" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
