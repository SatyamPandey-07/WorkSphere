/**
 * WebGL Context Lost & Restoration Manager (#909)
 *
 * Handles browser tab switching WebGL context lost events on map canvas layers,
 * preventing canvas blackout by preventing default loss behavior and re-initializing
 * WebGL buffer attributes upon context restoration.
 */

export interface WebGLBufferAttributes {
  positionBuffer?: WebGLBuffer | null;
  colorBuffer?: WebGLBuffer | null;
  textureBuffer?: WebGLBuffer | null;
}

export function reinitializeWebGLBuffers(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  points: Array<[number, number, number?]>,
): WebGLBufferAttributes {
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
  let _isLost = false;

  const handleContextLost = (e: Event) => {
    e.preventDefault();
    _isLost = true;
    console.warn(
      "[WebGL] Context lost detected on canvas. Preventing default discard.",
    );
  };

  const handleContextRestored = (_e: Event) => {
    _isLost = false;
    console.log(
      "[WebGL] Context successfully restored on canvas. Re-initializing buffers.",
    );

    let gl: WebGLRenderingContext | null = null;
    try {
      gl =
        (canvas.getContext("webgl2") as any) ||
        (canvas.getContext("webgl") as any) ||
        (canvas.getContext(
          "experimental-webgl",
        ) as WebGLRenderingContext | null);
    } catch {
      // Ignored in headless environments like jsdom
    }

    if (gl) {
      if (onRestoreCallback) {
        onRestoreCallback(gl as WebGLRenderingContext);
      }
    }
  };

  canvas.addEventListener("webglcontextlost", handleContextLost, false);
  canvas.addEventListener("webglcontextrestored", handleContextRestored, false);

  return () => {
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    canvas.removeEventListener("webglcontextrestored", handleContextRestored);
  };
}
