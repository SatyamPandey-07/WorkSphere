"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { WebGLTextureCache } from "@/lib/webgl/textureCache";
import {
  attachWebGLContextRecovery,
  reinitializeWebGLBuffers,
  type WebGLBufferAttributes,
} from "@/lib/webgl/contextManager";

export interface Venue3DLayoutViewerProps {
  venueId?: string;
  floorTextureUrl?: string;
  wallTextureUrl?: string;
  className?: string;
  onContextRestored?: () => void;
  onContextLost?: () => void;
}

/**
 * Venue3DLayoutViewer
 *
 * 3D Venue layout viewer with resilient WebGL context loss recovery (#10013).
 * Catches webglcontextlost, prevents browser abort, clears cached textures/buffers,
 * and seamlessly restores upon webglcontextrestored with graceful fallback UI.
 */
export function Venue3DLayoutViewer({
  venueId = "default-venue",
  floorTextureUrl,
  wallTextureUrl,
  className = "",
  onContextRestored,
  onContextLost,
}: Venue3DLayoutViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureCacheRef = useRef<WebGLTextureCache | null>(null);
  const buffersRef = useRef<WebGLBufferAttributes | null>(null);

  const [isContextLost, setIsContextLost] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  const initScene = useCallback(
    (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
      gl.viewport(0, 0, gl.drawingBufferWidth || 800, gl.drawingBufferHeight || 450);
      gl.clearColor(0.05, 0.05, 0.08, 1.0);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // Re-initialize layout mesh geometry buffers
      const layoutPoints: Array<[number, number, number]> = [
        [-1, -1, 0],
        [1, -1, 0],
        [1, 1, 0],
        [-1, 1, 0],
      ];
      buffersRef.current = reinitializeWebGLBuffers(
        gl,
        layoutPoints,
        canvasRef.current || undefined
      );
    },
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Initialize WebGL texture cache
    textureCacheRef.current = new WebGLTextureCache({ canvas });

    // Initialize WebGL context
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    try {
      gl =
        canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    } catch {
      gl = null;
    }

    if (gl && !gl.isContextLost()) {
      initScene(gl);
    }

    // Attach robust context recovery manager
    const detachRecovery = attachWebGLContextRecovery(
      canvas,
      (restoredGl) => {
        setIsContextLost(false);
        setIsRecovering(false);
        setRecoveryFailed(false);
        initScene(restoredGl);
        onContextRestored?.();
      },
      () => {
        setIsContextLost(true);
        setIsRecovering(true);
        onContextLost?.();
      },
      {
        onRestoreFailed: () => {
          setIsContextLost(true);
          setIsRecovering(false);
          setRecoveryFailed(true);
        },
        restoreTimeoutMs: 5000,
      }
    );

    return () => {
      detachRecovery();
      textureCacheRef.current?.dispose();
      textureCacheRef.current = null;
    };
  }, [initScene, onContextRestored, onContextLost]);

  const handleManualRetry = () => {
    setRecoveryFailed(false);
    setIsRecovering(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl && !gl.isContextLost()) {
        initScene(gl);
        setIsContextLost(false);
        setIsRecovering(false);
      }
    } catch {
      setRecoveryFailed(true);
      setIsRecovering(false);
    }
  };

  return (
    <div
      className={`relative w-full aspect-video rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden ${className}`}
      data-testid="venue-3d-layout-viewer"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        data-testid="venue-3d-canvas"
      />

      {/* Context Lost / Recovery / Fallback Overlay */}
      {isContextLost && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950/90 p-6 text-center backdrop-blur-sm"
          data-testid="webgl-context-lost-fallback"
        >
          {recoveryFailed ? (
            <div className="flex flex-col items-center max-w-sm space-y-3">
              <div className="rounded-full bg-rose-500/10 p-3 text-rose-400">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                3D Layout Graphics Unavailable
              </h3>
              <p className="text-xs text-zinc-400">
                Graphics context could not be restored automatically. Check GPU settings or click retry.
              </p>
              <button
                type="button"
                onClick={handleManualRetry}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-400"
                data-testid="retry-restore-button"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry 3D Render
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center max-w-sm space-y-3">
              <div className="rounded-full bg-amber-500/10 p-3 text-amber-400">
                <RefreshCw className="h-6 w-6 animate-spin" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Restoring 3D View...
              </h3>
              <p className="text-xs text-zinc-400">
                Graphics performance event detected. Re-initializing textures and 3D floor plan layout...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Venue3DLayoutViewer;
