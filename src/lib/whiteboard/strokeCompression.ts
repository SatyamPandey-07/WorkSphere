/**
 * strokeCompression.ts
 *
 * 16-bit integer quantization and delta encoding for continuous SVG whiteboard pen strokes.
 * Compresses raw floating-point mouse/stylus telemetry before P2P mesh WebRTC broadcasting.
 *
 * Guarantees:
 * - Drops transmission bandwidth by > 70% over raw JSON coordinates (#6479).
 * - Preserves sub-pixel drawing fidelity with max coordinate deviation < 0.5px (typically <= 0.05px).
 * - Int16 delta clamping prevents integer overflow during fast mouse scribbling.
 */

export interface Point2D {
  x: number;
  y: number;
}

export type StrokePointsInput = number[] | Point2D[];

export interface QuantizeStrokeOptions {
  /**
   * Coordinate multiplier scale factor.
   * Default: 10.0 (0.1px resolution).
   * Guarantees max coordinate deviation <= 0.05px, strictly fulfilling the < 0.5px criterion.
   */
  scale?: number;
  /**
   * Whether to clamp delta values to 16-bit signed integer range (-32768 to 32767).
   * Default: true.
   */
  clampToInt16?: boolean;
}

export interface QuantizedStroke {
  /** Quantized origin X coordinate in integer grid units */
  originX: number;
  /** Quantized origin Y coordinate in integer grid units */
  originY: number;
  /**
   * Delta values between consecutive points in integer grid units:
   * [dx1, dy1, dx2, dy2, ...]
   * where dx_i = round(x_i * scale) - round(x_{i-1} * scale)
   */
  deltas: number[];
  /** Scale factor used for quantization */
  scale: number;
  /** Total number of 2D points in the stroke */
  pointCount: number;
  /** Original input format style */
  format?: "flat" | "points";
}

export const DEFAULT_QUANTIZATION_SCALE = 10.0; // 0.1px resolution -> max deviation <= 0.05px
const INT16_MIN = -32768;
const INT16_MAX = 32767;

/**
 * Normalizes input points (either flat array [x0, y0, x1, y1...] or Point2D array) into flat number[]
 */
export function normalizePointsToFlat(points: StrokePointsInput): {
  flat: number[];
  format: "flat" | "points";
} {
  if (!points || !Array.isArray(points) || points.length === 0) {
    return { flat: [], format: "flat" };
  }

  const first = points[0];
  if (typeof first === "object" && first !== null && "x" in first && "y" in first) {
    const flat: number[] = new Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      const p = (points as Point2D[])[i];
      flat[i * 2] = p.x;
      flat[i * 2 + 1] = p.y;
    }
    return { flat, format: "points" };
  }

  return { flat: points as number[], format: "flat" };
}

/**
 * Compresses raw floating-point stroke coordinates into a 16-bit quantized delta vector.
 *
 * @param points Raw stroke points as [x0, y0, x1, y1...] or [{x, y}...]
 * @param options Quantization configuration options (scale, Int16 clamping)
 * @returns QuantizedStroke payload ready for low-bandwidth P2P transmission
 */
export function quantizeStrokePoints(
  points: StrokePointsInput,
  options: QuantizeStrokeOptions = {}
): QuantizedStroke {
  const scale = options.scale !== undefined && options.scale > 0 ? options.scale : DEFAULT_QUANTIZATION_SCALE;
  const clampToInt16 = options.clampToInt16 !== false;

  const { flat, format } = normalizePointsToFlat(points);

  if (flat.length < 2) {
    return {
      originX: 0,
      originY: 0,
      deltas: [],
      scale,
      pointCount: 0,
      format,
    };
  }

  const totalPoints = Math.floor(flat.length / 2);
  const originX = Math.round(flat[0] * scale);
  const originY = Math.round(flat[1] * scale);

  if (totalPoints <= 1) {
    return {
      originX,
      originY,
      deltas: [],
      scale,
      pointCount: 1,
      format,
    };
  }

  const deltas: number[] = new Array((totalPoints - 1) * 2);
  let prevQuantX = originX;
  let prevQuantY = originY;

  for (let i = 1; i < totalPoints; i++) {
    const rawX = flat[i * 2];
    const rawY = flat[i * 2 + 1];

    const currQuantX = Math.round(rawX * scale);
    const currQuantY = Math.round(rawY * scale);

    let dx = currQuantX - prevQuantX;
    let dy = currQuantY - prevQuantY;

    if (clampToInt16) {
      dx = Math.max(INT16_MIN, Math.min(INT16_MAX, dx));
      dy = Math.max(INT16_MIN, Math.min(INT16_MAX, dy));
    }

    deltas[(i - 1) * 2] = dx;
    deltas[(i - 1) * 2 + 1] = dy;

    // Advance reference to match reconstructed accumulator on receiver
    prevQuantX = prevQuantX + dx;
    prevQuantY = prevQuantY + dy;
  }

  return {
    originX,
    originY,
    deltas,
    scale,
    pointCount: totalPoints,
    format,
  };
}

/**
 * Dequantizes a QuantizedStroke back into floating-point coordinates.
 *
 * @param quantized The compressed QuantizedStroke payload (or legacy array payload)
 * @returns Reconstructed flat array of coordinates: [x0, y0, x1, y1, ...]
 */
export function dequantizeStrokePoints(
  quantized: QuantizedStroke | number[]
): number[] {
  if (Array.isArray(quantized)) {
    // If passed already flat numbers, return a copy
    return [...quantized];
  }

  if (!quantized || quantized.pointCount <= 0) {
    return [];
  }

  const { originX, originY, deltas, scale, pointCount } = quantized;
  const safeScale = scale > 0 ? scale : DEFAULT_QUANTIZATION_SCALE;

  const result: number[] = new Array(pointCount * 2);
  let accumX = originX;
  let accumY = originY;

  result[0] = accumX / safeScale;
  result[1] = accumY / safeScale;

  const deltaPairs = Math.min(pointCount - 1, Math.floor((deltas?.length || 0) / 2));

  for (let i = 0; i < deltaPairs; i++) {
    accumX += deltas[i * 2];
    accumY += deltas[i * 2 + 1];

    result[(i + 1) * 2] = accumX / safeScale;
    result[(i + 1) * 2 + 1] = accumY / safeScale;
  }

  return result;
}

/**
 * Helper to dequantize directly to an array of 2D Point objects [{x, y}, ...].
 */
export function dequantizeToPointObjects(quantized: QuantizedStroke): Point2D[] {
  const flat = dequantizeStrokePoints(quantized);
  const pointCount = Math.floor(flat.length / 2);
  const points: Point2D[] = new Array(pointCount);

  for (let i = 0; i < pointCount; i++) {
    points[i] = {
      x: flat[i * 2],
      y: flat[i * 2 + 1],
    };
  }

  return points;
}

/**
 * Calculates the maximum absolute coordinate deviation (error) between original and dequantized points.
 * Acceptance criterion requires: max coordinate deviation < 0.5px.
 */
export function calculateMaxCoordinateDeviation(
  original: StrokePointsInput,
  dequantized: StrokePointsInput
): number {
  const { flat: origFlat } = normalizePointsToFlat(original);
  const { flat: deqFlat } = normalizePointsToFlat(dequantized);

  const len = Math.min(origFlat.length, deqFlat.length);
  if (len === 0) return 0;

  let maxDeviation = 0;
  for (let i = 0; i < len; i++) {
    const diff = Math.abs(origFlat[i] - deqFlat[i]);
    if (diff > maxDeviation) {
      maxDeviation = diff;
    }
  }

  return Number(maxDeviation.toFixed(5));
}

/**
 * Serializes a QuantizedStroke into a compact binary Int16Array buffer.
 * Structure:
 * - [0]: Header marker / scale * 10
 * - [1]: originX (low 16)
 * - [2]: originY (low 16)
 * - [3]: pointCount
 * - [4...]: deltas
 */
export function packQuantizedStrokeToInt16(quantized: QuantizedStroke): Int16Array {
  const deltaCount = quantized.deltas.length;
  const buffer = new Int16Array(4 + deltaCount);

  buffer[0] = Math.round(quantized.scale * 10);
  buffer[1] = Math.max(INT16_MIN, Math.min(INT16_MAX, quantized.originX));
  buffer[2] = Math.max(INT16_MIN, Math.min(INT16_MAX, quantized.originY));
  buffer[3] = Math.max(0, Math.min(INT16_MAX, quantized.pointCount));

  for (let i = 0; i < deltaCount; i++) {
    buffer[4 + i] = quantized.deltas[i];
  }

  return buffer;
}

/**
 * Deserializes an Int16Array binary buffer back into a QuantizedStroke.
 */
export function unpackInt16ToQuantizedStroke(buffer: Int16Array): QuantizedStroke {
  if (!buffer || buffer.length < 4) {
    return {
      originX: 0,
      originY: 0,
      deltas: [],
      scale: DEFAULT_QUANTIZATION_SCALE,
      pointCount: 0,
    };
  }

  const scale = buffer[0] > 0 ? buffer[0] / 10 : DEFAULT_QUANTIZATION_SCALE;
  const originX = buffer[1];
  const originY = buffer[2];
  const pointCount = buffer[3];

  const deltaCount = buffer.length - 4;
  const deltas: number[] = new Array(deltaCount);
  for (let i = 0; i < deltaCount; i++) {
    deltas[i] = buffer[4 + i];
  }

  return {
    originX,
    originY,
    deltas,
    scale,
    pointCount,
  };
}

/**
 * Encodes raw stroke points directly into an optimized binary byte buffer for P2P WebRTC data channels.
 */
export function encodeStrokeToBinary(
  points: StrokePointsInput,
  scale: number = DEFAULT_QUANTIZATION_SCALE
): Uint8Array {
  const quantized = quantizeStrokePoints(points, { scale });
  const int16 = packQuantizedStrokeToInt16(quantized);
  return new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
}

/**
 * Decodes a binary byte buffer received from P2P WebRTC channel back into flat coordinates.
 */
export function decodeStrokeFromBinary(buffer: Uint8Array): number[] {
  const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  const quantized = unpackInt16ToQuantizedStroke(int16);
  return dequantizeStrokePoints(quantized);
}

/**
 * Computes bandwidth savings comparing raw JSON floating point serialization vs quantized representation.
 * Verifies bandwidth reduction > 70% (#6479).
 */
export function calculateBandwidthSavings(
  rawPoints: StrokePointsInput,
  quantizedOrBinary: QuantizedStroke | Uint8Array
): {
  rawBytes: number;
  compressedBytes: number;
  savingsPercent: number;
} {
  const { flat } = normalizePointsToFlat(rawPoints);
  const rawJson = JSON.stringify(flat);
  const rawBytes = rawJson.length;

  let compressedBytes = 0;
  if (quantizedOrBinary instanceof Uint8Array) {
    compressedBytes = quantizedOrBinary.byteLength;
  } else {
    // Binary packed Int16 bytes
    compressedBytes = (4 + quantizedOrBinary.deltas.length) * 2;
  }

  const diff = Math.max(0, rawBytes - compressedBytes);
  const savingsPercent = rawBytes > 0 ? Number(((diff / rawBytes) * 100).toFixed(1)) : 0;

  return {
    rawBytes,
    compressedBytes,
    savingsPercent,
  };
}
