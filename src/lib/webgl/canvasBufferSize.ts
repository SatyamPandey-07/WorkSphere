/**
 * High-DPI (Retina) canvas drawing-buffer sizing for WebGL recovery (#1030).
 *
 * After a context-lost restore, browsers may leave the drawing buffer at CSS
 * pixel size. Multiplying by devicePixelRatio reallocates the correct buffer
 * so the viewport is not blurry / quarter-sized on dpr >= 2 displays.
 */

export type CanvasBufferSize = {
  width: number;
  height: number;
  dpr: number;
};

/**
 * Reallocate the canvas backing store as CSS size × devicePixelRatio.
 * Returns the buffer dimensions used for gl.viewport / uniforms.
 */
export function allocateCanvasDrawingBuffer(
  canvas: HTMLCanvasElement,
  cssWidth?: number,
  cssHeight?: number,
): CanvasBufferSize {
  const dpr =
    typeof window !== "undefined" && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;

  const hasExplicitW = cssWidth != null && cssWidth > 0;
  const hasExplicitH = cssHeight != null && cssHeight > 0;
  const hasClientW = canvas.clientWidth > 0;
  const hasClientH = canvas.clientHeight > 0;

  // Not laid out and no explicit CSS size — keep current buffer; do not
  // multiply an already-scaled buffer by dpr again on a second restore.
  if (!hasExplicitW && !hasClientW && !hasExplicitH && !hasClientH) {
    return {
      width: Math.max(1, canvas.width || 1),
      height: Math.max(1, canvas.height || 1),
      dpr,
    };
  }

  const displayWidth = Math.max(
    1,
    Math.round(hasExplicitW ? cssWidth! : hasClientW ? canvas.clientWidth : 1),
  );
  const displayHeight = Math.max(
    1,
    Math.round(
      hasExplicitH ? cssHeight! : hasClientH ? canvas.clientHeight : 1,
    ),
  );

  const width = Math.max(1, Math.round(displayWidth * dpr));
  const height = Math.max(1, Math.round(displayHeight * dpr));

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  return { width, height, dpr };
}
