/**
 * crowdCounter.ts
 *
 * Connected-component labeling and blob area analysis for high-resolution
 * video streams (including 4K 3840x2160). Uses 32-bit unsigned integers (uint32_t)
 * for all coordinate, dimension, and area calculations to prevent 16-bit integer overflow.
 *
 * Mirrors the C implementation in src/wasm/vision/crowd_counter.c.
 */

export interface CrowdBlob {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
  area: number;
  pixelCount: number;
}

export interface BlobDetectionResult {
  blobs: CrowdBlob[];
  count: number;
}

/**
 * Sanity check validating whether a bounding box is strictly within the frame resolution.
 * Rejects invalid coordinates, inverted bounds, or bounding boxes exceeding frame resolution.
 */
export function validateBoundingBox(
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  frameWidth: number,
  frameHeight: number,
): boolean {
  if (frameWidth <= 0 || frameHeight <= 0) {
    return false;
  }
  if (xMin > xMax || yMin > yMax) {
    return false;
  }
  if (xMin < 0 || yMin < 0) {
    return false;
  }
  if (xMax >= frameWidth || yMax >= frameHeight) {
    return false;
  }

  const boxW = xMax - xMin + 1;
  const boxH = yMax - yMin + 1;
  if (boxW > frameWidth || boxH > frameHeight) {
    return false;
  }

  const boxArea = boxW * boxH;
  const maxArea = frameWidth * frameHeight;
  if (boxArea > maxArea) {
    return false;
  }

  return true;
}

/**
 * Calculates blob bounding box area using 32-bit unsigned integer arithmetic (uint32_t).
 * Prevents 16-bit integer overflow on 4K resolutions (3840x2160).
 */
export function calculateBlobArea(boxWidth: number, boxHeight: number): number {
  if (boxWidth <= 0 || boxHeight <= 0) return 0;
  // Unsigned 32-bit multiplication
  const area = (boxWidth * boxHeight) >>> 0;
  return area;
}

/**
 * Legacy 16-bit signed integer area calculation (int16_t) demonstrating
 * the overflow vulnerability where dimensions exceeding 32,767 wrap around to negative.
 */
export function calculateBlobAreaInt16Legacy(
  boxWidth: number,
  boxHeight: number,
): number {
  const area32 = boxWidth * boxHeight;
  // Simulate 16-bit signed integer wrap-around (int16_t)
  const int16Area = (area32 << 16) >> 16;
  return int16Area;
}

/**
 * Filter blob by area using 32-bit unsigned integer calculations.
 * Returns true if blob area falls within [minArea, maxArea], false otherwise.
 */
export function filterBlobByArea(
  boxWidth: number,
  boxHeight: number,
  minArea: number,
  maxArea: number,
): { valid: boolean; area: number } {
  const area = calculateBlobArea(boxWidth, boxHeight);
  const valid = area >= minArea && area <= maxArea;
  return { valid, area };
}

interface LabelComponent {
  parent: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  pixelCount: number;
}

function dsuFind(comp: LabelComponent[], i: number): number {
  let root = i;
  while (root !== comp[root].parent) {
    root = comp[root].parent;
  }
  let curr = i;
  while (curr !== root) {
    const next = comp[curr].parent;
    comp[curr].parent = root;
    curr = next;
  }
  return root;
}

function dsuUnion(comp: LabelComponent[], root1: number, root2: number): void {
  if (root1 === root2) return;
  comp[root2].parent = root1;
  if (comp[root2].xMin < comp[root1].xMin) comp[root1].xMin = comp[root2].xMin;
  if (comp[root2].yMin < comp[root1].yMin) comp[root1].yMin = comp[root2].yMin;
  if (comp[root2].xMax > comp[root1].xMax) comp[root1].xMax = comp[root2].xMax;
  if (comp[root2].yMax > comp[root1].yMax) comp[root1].yMax = comp[root2].yMax;
  comp[root1].pixelCount += comp[root2].pixelCount;
}

/**
 * Connected-component labeling pass to detect and isolate crowd blobs from a binary motion mask.
 * Uses uint32_t coordinates and areas to support resolutions up to 4K (3840x2160).
 */
export function extractCrowdBlobs(
  binaryMask: Uint8Array,
  width: number,
  height: number,
  minArea: number = 0,
  maxArea: number = 0xffffffff,
): BlobDetectionResult {
  const result: BlobDetectionResult = {
    blobs: [],
    count: 0,
  };

  if (!binaryMask || width <= 0 || height <= 0) {
    return result;
  }

  let prevRow = new Uint32Array(width);
  let currRow = new Uint32Array(width);

  const maxComponents = 16384;
  const comp: LabelComponent[] = new Array(maxComponents);
  let numLabels = 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const pixel = binaryMask[rowOffset + x];
      if (pixel === 0) {
        currRow[x] = 0;
        continue;
      }

      const topLabel = y > 0 ? prevRow[x] : 0;
      const leftLabel = x > 0 ? currRow[x - 1] : 0;

      if (topLabel === 0 && leftLabel === 0) {
        if (numLabels + 1 < maxComponents) {
          numLabels++;
          comp[numLabels] = {
            parent: numLabels,
            xMin: x,
            yMin: y,
            xMax: x,
            yMax: y,
            pixelCount: 1,
          };
          currRow[x] = numLabels;
        } else {
          currRow[x] = 0;
        }
      } else if (topLabel !== 0 && leftLabel === 0) {
        const root = dsuFind(comp, topLabel);
        if (x < comp[root].xMin) comp[root].xMin = x;
        if (x > comp[root].xMax) comp[root].xMax = x;
        if (y > comp[root].yMax) comp[root].yMax = y;
        comp[root].pixelCount++;
        currRow[x] = root;
      } else if (topLabel === 0 && leftLabel !== 0) {
        const root = dsuFind(comp, leftLabel);
        if (x < comp[root].xMin) comp[root].xMin = x;
        if (x > comp[root].xMax) comp[root].xMax = x;
        if (y > comp[root].yMax) comp[root].yMax = y;
        comp[root].pixelCount++;
        currRow[x] = root;
      } else {
        const rootTop = dsuFind(comp, topLabel);
        const rootLeft = dsuFind(comp, leftLabel);
        if (rootTop === rootLeft) {
          const root = rootTop;
          if (x < comp[root].xMin) comp[root].xMin = x;
          if (x > comp[root].xMax) comp[root].xMax = x;
          if (y > comp[root].yMax) comp[root].yMax = y;
          comp[root].pixelCount++;
          currRow[x] = root;
        } else {
          dsuUnion(comp, rootTop, rootLeft);
          if (x < comp[rootTop].xMin) comp[rootTop].xMin = x;
          if (x > comp[rootTop].xMax) comp[rootTop].xMax = x;
          if (y > comp[rootTop].yMax) comp[rootTop].yMax = y;
          comp[rootTop].pixelCount++;
          currRow[x] = rootTop;
        }
      }
    }

    const tmp = prevRow;
    prevRow = currRow;
    currRow = tmp;
  }

  for (let i = 1; i <= numLabels; i++) {
    if (comp[i] && comp[i].parent === i && comp[i].pixelCount > 0) {
      const xMin = comp[i].xMin;
      const yMin = comp[i].yMin;
      const xMax = comp[i].xMax;
      const yMax = comp[i].yMax;

      // Sanity check rejecting bounding boxes exceeding frame resolution
      if (!validateBoundingBox(xMin, yMin, xMax, yMax, width, height)) {
        continue;
      }

      const bw = xMax - xMin + 1;
      const bh = yMax - yMin + 1;
      const area = calculateBlobArea(bw, bh);

      // Area threshold filter using uint32_t without 16-bit negative overflow
      if (area >= minArea && area <= maxArea) {
        result.blobs.push({
          xMin,
          yMin,
          xMax,
          yMax,
          width: bw,
          height: bh,
          area,
          pixelCount: comp[i].pixelCount,
        });
        result.count++;
      }
    }
  }

  return result;
}

/**
 * Convenience helper counting valid crowd blobs within the specified area thresholds.
 */
export function countCrowdBlobs(
  binaryMask: Uint8Array,
  width: number,
  height: number,
  minArea: number = 0,
  maxArea: number = 0xffffffff,
): number {
  const result = extractCrowdBlobs(binaryMask, width, height, minArea, maxArea);
  return result.count;
}
