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
  radius?: number;   // Influence radius in pixels
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

  useEffect(() => {
    if (!map || typeof window === "undefined" || !L || !L.DomUtil || typeof L.DomUtil.create !== "function") return;

    // Create canvas container overlay inside Leaflet overlayPane
    const canvas = L.DomUtil.create("canvas", "leaflet-webgl-heatmap-layer") as HTMLCanvasElement;
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

    // Initialize WebGL Heatmap Renderer
    const renderer = new WebGLHeatmapRenderer(canvas, { opacity, blur });
    rendererRef.current = renderer;

    const updateCanvasPositionAndRender = () => {
      if (!canvas || !rendererRef.current || !map) return;

      const size = map.getSize();
      const pixelRatio = window.devicePixelRatio || 1;

      // Match canvas dimensions to viewport
      const width = size.x;
      const height = size.y;

      if (canvas.width !== width * pixelRatio || canvas.height !== height * pixelRatio) {
        canvas.width = width * pixelRatio;
        canvas.height = height * pixelRatio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      // Reposition canvas overlay to map top-left
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);

      // Convert geographical points to viewport pixel coordinates
      const heatmapPoints: HeatmapPoint[] = [];
      const currentZoom = map.getZoom();

      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const containerPt = map.latLngToContainerPoint([pt.lat, pt.lng]);
        
        // Skip points far outside viewport bounds for optimization
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

      // Upload VBO buffer data to GPU
      rendererRef.current.updatePoints(heatmapPoints);

      // Request 60 FPS hardware frame render
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }

      animFrameRef.current = requestAnimationFrame(() => {
        if (rendererRef.current && visible) {
          rendererRef.current.render(width * pixelRatio, height * pixelRatio, currentZoom);
        }
      });
    };

    // Attach Leaflet map event listeners
    map.on("move", updateCanvasPositionAndRender);
    map.on("zoom", updateCanvasPositionAndRender);
    map.on("resize", updateCanvasPositionAndRender);

    // Initial render
    updateCanvasPositionAndRender();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      map.off("move", updateCanvasPositionAndRender);
      map.off("zoom", updateCanvasPositionAndRender);
      map.off("resize", updateCanvasPositionAndRender);

      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      canvasRef.current = null;
    };
  }, [map, points, opacity, blur, visible]);

  return null;
}
