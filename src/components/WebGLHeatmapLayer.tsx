"use client";

/**
 * Distributed WebGL Leaflet Heatmap Layer Component (#818)
 *
 * Integrates WebGLHeatmapRenderer with React-Leaflet map viewports. Converts geographical
 * coordinates to screen space and renders continuous GPU spatial density clustering at 60 FPS.
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import {
  WebGLHeatmapRenderer,
  HeatmapPoint,
} from "@/lib/webgl/webglHeatmapRenderer";

export interface GeoTelemetryPoint {
  lat: number;
  lng: number;
  intensity: number; // 0.0 to 1.0
  radius?: number; // Influence radius in pixels
}

interface WebGLHeatmapLayerProps {
  points: GeoTelemetryPoint[];
  opacity?: number;
  blur?: number;
  visible?: boolean;
}

export function WebGLHeatmapLayer({
  points,
  opacity = 0.85,
  blur = 1.0,
  visible = true,
}: WebGLHeatmapLayerProps) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGLHeatmapRenderer | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Refs so event handlers (attached once) always see the latest props
  // without forcing the whole setup effect to re-run.
  const pointsRef = useRef(points);
  const visibleRef = useRef(visible);
  useEffect(() => {
    pointsRef.current = points;
    visibleRef.current = visible;
  }, [points, visible]);

  const renderFrame = () => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !map) return;
    canvas.style.display = visibleRef.current ? "" : "none";
    if (!visibleRef.current) return;

    const size = map.getSize();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = size.x;
    const height = size.y;

    if (
      canvas.width !== width * pixelRatio ||
      canvas.height !== height * pixelRatio
    ) {
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);

    const heatmapPoints: HeatmapPoint[] = [];
    const currentZoom = map.getZoom();

    for (let i = 0; i < pointsRef.current.length; i++) {
      const pt = pointsRef.current[i];
      const containerPt = map.latLngToContainerPoint([pt.lat, pt.lng]);

      if (
        containerPt.x < -100 ||
        containerPt.x > width + 100 ||
        containerPt.y < -100 ||
        containerPt.y > height + 100
      ) {
        continue;
      }

      heatmapPoints.push({
        x: containerPt.x * pixelRatio,
        y: containerPt.y * pixelRatio,
        intensity: pt.intensity,
        radius: (pt.radius ?? 25) * pixelRatio,
      });
    }

    renderer.updatePoints(heatmapPoints);

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    animFrameRef.current = requestAnimationFrame(() => {
      if (rendererRef.current && visibleRef.current) {
        rendererRef.current.render(
          width * pixelRatio,
          height * pixelRatio,
          currentZoom,
        );
      }
    });
  };

  // Mount-only setup: create the canvas + GL context ONCE per map instance.
  // Notice `points` is NOT in this dependency array — that was the leak.
  useEffect(() => {
    if (!map || typeof window === "undefined" || !L?.DomUtil?.create) return;

    const canvas = L.DomUtil.create(
      "canvas",
      "leaflet-webgl-heatmap-layer",
    ) as HTMLCanvasElement;
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "400";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const overlayPane = map.getPanes().overlayPane;
    overlayPane.appendChild(canvas);
    canvasRef.current = canvas;

    const renderer = new WebGLHeatmapRenderer(canvas, { opacity, blur });
    rendererRef.current = renderer;

    map.on("move", renderFrame);
    map.on("zoom", renderFrame);
    map.on("resize", renderFrame);

    renderFrame();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      map.off("move", renderFrame);
      map.off("zoom", renderFrame);
      map.off("resize", renderFrame);

      rendererRef.current?.destroy();
      rendererRef.current = null;

      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Data/style updates: just re-upload + re-draw. Never touches the GL context.
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setOpacity(opacity);
      rendererRef.current.setBlur(blur);
    }
    renderFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, opacity, blur, visible]);

  return null;
}
