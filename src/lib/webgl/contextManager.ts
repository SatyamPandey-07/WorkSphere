/**
 * WebGL Context Lost & Restoration Manager (#909)
 *
 * Handles browser tab switching WebGL context lost events on map canvas layers,
 * preventing canvas blackout by preventing default loss behavior and re-initializing
 * WebGL buffer attributes upon context restoration.
 */

import { allocateCanvasDrawingBuffer } from "./canvasBufferSize";
import { WebGLContextRecoveryManager } from "./WebGLContextRecoveryManager";

export interface WebGLBufferAttributes {
  positionBuffer?: WebGLBuffer | null;
  colorBuffer?: WebGLBuffer | null;
  textureBuffer?: WebGLBuffer | null;
}

export function reinitializeWebGLBuffers(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  points: Array<[number, number, number?]>,
  canvas?: HTMLCanvasElement,
): WebGLBufferAttributes {
  // High-DPI recovery: size the drawing buffer with devicePixelRatio (#1030)
  if (canvas) {
    const { width, height } = allocateCanvasDrawingBuffer(canvas);
    gl.viewport(0, 0, width, height);
  }

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

  const flatCoords = new Float32Array(
    points.flatMap(([lat, lng, val]) => [lat, lng, val ?? 1.0]),
  );
  gl.bufferData(gl.ARRAY_BUFFER, flatCoords, gl.STATIC_DRAW);

  return { positionBuffer };
}

export function attachWebGLContextRecovery(
  canvas: HTMLCanvasElement,
  onRestoreCallback?: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
  ) => void,
): () => void {
  const manager = new WebGLContextRecoveryManager(canvas, {
    onRestore: (gl) => {
      if (onRestoreCallback) {
        onRestoreCallback(gl);
      }
    },
  });
  return () => manager.destroy();
}
