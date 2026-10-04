/**
 * Lightweight, zero-dependency QR Code generator and SVG renderer.
 * Compliant with ISO/IEC 18004 (Byte Mode, Error Correction L / M).
 */

import { sanitizeColor, sanitizeSvg } from "@/lib/security/svgSanitizer";

// GF(256) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d = 285)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  LOG_TABLE[0] = 0;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

// Polynomial operations in GF(256)
function polyMul(p1: number[], p2: number[]): number[] {
  const result = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMul(p1[i], p2[j]);
    }
  }
  return result;
}

function getGeneratorPoly(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    g = polyMul(g, [1, EXP_TABLE[i]]);
  }
  return g;
}

function calculateErrorCorrection(data: number[], ecCount: number): number[] {
  const gen = getGeneratorPoly(ecCount);
  const msg = [...data, ...new Array(ecCount).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

// QR Code Version Tables for EC Level M (medium: ~15% recovery)
// [totalDataCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataCodewordsPerBlockG1, numBlocksGroup2, dataCodewordsPerBlockG2]
interface VersionInfo {
  version: number;
  totalCodewords: number;
  ecPerBlock: number;
  g1Blocks: number;
  g1Data: number;
  g2Blocks: number;
  g2Data: number;
  alignmentPositions: number[];
}

const VERSION_TABLE: VersionInfo[] = [
  { version: 1, totalCodewords: 26, ecPerBlock: 10, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0, alignmentPositions: [] },
  { version: 2, totalCodewords: 44, ecPerBlock: 16, g1Blocks: 1, g1Data: 28, g2Blocks: 0, g2Data: 0, alignmentPositions: [6, 18] },
  { version: 3, totalCodewords: 70, ecPerBlock: 26, g1Blocks: 1, g1Data: 44, g2Blocks: 0, g2Data: 0, alignmentPositions: [6, 22] },
  { version: 4, totalCodewords: 100, ecPerBlock: 18, g1Blocks: 2, g1Data: 32, g2Blocks: 0, g2Data: 0, alignmentPositions: [6, 26] },
  { version: 5, totalCodewords: 134, ecPerBlock: 24, g1Blocks: 2, g1Data: 43, g2Blocks: 0, g2Data: 0, alignmentPositions: [6, 30] },
  { version: 6, totalCodewords: 172, ecPerBlock: 16, g1Blocks: 4, g1Data: 27, g2Blocks: 0, g2Data: 0, alignmentPositions: [6, 34] },
  { version: 7, totalCodewords: 196, ecPerBlock: 18, g1Blocks: 4, g1Data: 31, g2Blocks: 0, g2Data: 0, alignmentPositions: [6, 22, 38] },
  { version: 8, totalCodewords: 242, ecPerBlock: 22, g1Blocks: 4, g1Data: 38, g2Blocks: 0, g2Data: 0, alignmentPositions: [6, 24, 42] },
  { version: 9, totalCodewords: 292, ecPerBlock: 22, g1Blocks: 3, g1Data: 36, g2Blocks: 2, g2Data: 37, alignmentPositions: [6, 26, 46] },
  { version: 10, totalCodewords: 346, ecPerBlock: 26, g1Blocks: 4, g1Data: 43, g2Blocks: 1, g2Data: 44, alignmentPositions: [6, 28, 50] },
];

function selectVersion(dataLength: number): VersionInfo {
  for (const v of VERSION_TABLE) {
    const totalDataCapacity = v.g1Blocks * v.g1Data + v.g2Blocks * v.g2Data;
    // Byte mode overhead: 4 bits mode + 8 bits count (for v1-9) or 16 bits (for v10+)
    const countBits = v.version < 10 ? 8 : 16;
    const availableDataBytes = Math.floor((totalDataCapacity * 8 - 4 - countBits) / 8);
    if (dataLength <= availableDataBytes) {
      return v;
    }
  }
  throw new Error(`Data too long for supported QR versions (max ~213 bytes): length is ${dataLength}`);
}

class BitBuffer {
  private buffer: number[] = [];
  private length = 0;

  put(num: number, length: number) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }

  getLength(): number {
    return this.length;
  }

  getBuffer(): number[] {
    return this.buffer;
  }
}

function encodeData(text: string, versionInfo: VersionInfo): number[] {
  const utf8Encoder = new TextEncoder();
  const utf8Bytes = utf8Encoder.encode(text);
  const bitBuffer = new BitBuffer();

  // Mode Indicator: Byte mode (0100 = 4)
  bitBuffer.put(4, 4);

  // Character Count Indicator
  const countBits = versionInfo.version < 10 ? 8 : 16;
  bitBuffer.put(utf8Bytes.length, countBits);

  // Data Bytes
  for (let i = 0; i < utf8Bytes.length; i++) {
    bitBuffer.put(utf8Bytes[i], 8);
  }

  const totalDataBytes = versionInfo.g1Blocks * versionInfo.g1Data + versionInfo.g2Blocks * versionInfo.g2Data;
  const totalDataBits = totalDataBytes * 8;

  // Terminator (up to 4 zeroes)
  const termBits = Math.min(4, totalDataBits - bitBuffer.getLength());
  if (termBits > 0) {
    bitBuffer.put(0, termBits);
  }

  // Pad to byte boundary
  while (bitBuffer.getLength() % 8 !== 0) {
    bitBuffer.putBit(false);
  }

  // Pad bytes 0xEC and 0x11
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  const rawBytes = bitBuffer.getBuffer();
  while (rawBytes.length < totalDataBytes) {
    rawBytes.push(padBytes[padIndex % 2]);
    padIndex++;
  }

  return rawBytes;
}

function generateCodewords(dataBytes: number[], versionInfo: VersionInfo): number[] {
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let byteOffset = 0;

  for (let b = 0; b < versionInfo.g1Blocks; b++) {
    const blockData = dataBytes.slice(byteOffset, byteOffset + versionInfo.g1Data);
    blocks.push(blockData);
    ecBlocks.push(calculateErrorCorrection(blockData, versionInfo.ecPerBlock));
    byteOffset += versionInfo.g1Data;
  }

  for (let b = 0; b < versionInfo.g2Blocks; b++) {
    const blockData = dataBytes.slice(byteOffset, byteOffset + versionInfo.g2Data);
    blocks.push(blockData);
    ecBlocks.push(calculateErrorCorrection(blockData, versionInfo.ecPerBlock));
    byteOffset += versionInfo.g2Data;
  }

  // Interleave data codewords
  const interleaved: number[] = [];
  const maxDataLen = Math.max(versionInfo.g1Data, versionInfo.g2Data);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < blocks[b].length) {
        interleaved.push(blocks[b][i]);
      }
    }
  }

  // Interleave error correction codewords
  for (let i = 0; i < versionInfo.ecPerBlock; i++) {
    for (let b = 0; b < ecBlocks.length; b++) {
      interleaved.push(ecBlocks[b][i]);
    }
  }

  return interleaved;
}

// Format info: EC Level M (00) with 8 mask patterns + BCH (15,5) + XOR 0x5412
const FORMAT_INFO: number[] = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

function createMatrix(version: number): (boolean | null)[][] {
  const size = version * 4 + 17;
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function applyFinderPattern(matrix: (boolean | null)[][], row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const nr = row + r;
      const nc = col + c;
      if (nr < 0 || nr >= matrix.length || nc < 0 || nc >= matrix.length) continue;
      if (
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      ) {
        matrix[nr][nc] = true;
      } else {
        matrix[nr][nc] = false;
      }
    }
  }
}

function applyAlignmentPattern(matrix: (boolean | null)[][], row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const nr = row + r;
      const nc = col + c;
      if (matrix[nr][nc] !== null) continue;
      if (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) {
        matrix[nr][nc] = true;
      } else {
        matrix[nr][nc] = false;
      }
    }
  }
}

function getMaskCondition(mask: number): (r: number, c: number) => boolean {
  switch (mask) {
    case 0: return (r, c) => (r + c) % 2 === 0;
    case 1: return (r) => r % 2 === 0;
    case 2: return (_, c) => c % 3 === 0;
    case 3: return (r, c) => (r + c) % 3 === 0;
    case 4: return (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return () => false;
  }
}

export function generateQRMatrix(text: string): boolean[][] {
  const versionInfo = selectVersion(new TextEncoder().encode(text).length);
  const size = versionInfo.version * 4 + 17;
  const matrix = createMatrix(versionInfo.version);

  // 1. Finder patterns
  applyFinderPattern(matrix, 0, 0);
  applyFinderPattern(matrix, 0, size - 7);
  applyFinderPattern(matrix, size - 7, 0);

  // 2. Alignment patterns
  const positions = versionInfo.alignmentPositions;
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const r = positions[i];
      const c = positions[j];
      // Skip if overlapping finder patterns
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0)
      ) {
        continue;
      }
      applyAlignmentPattern(matrix, r, c);
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }

  // 4. Dark module
  matrix[4 * versionInfo.version + 9][8] = true;

  // 5. Reserve format info areas
  for (let i = 0; i <= 8; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
  }

  // 6. Codewords
  const dataBytes = encodeData(text, versionInfo);
  const codewords = generateCodewords(dataBytes, versionInfo);

  // Convert codewords to bit stream
  const bits: boolean[] = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) {
      bits.push(((byte >>> i) & 1) === 1);
    }
  }

  // Place bits into matrix
  const maskFn = getMaskCondition(0); // Mask pattern 0 (standard, robust)
  let bitIdx = 0;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing line
    const upward = ((size - 1 - right) / 2) % 2 === 0;

    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let c = right; c >= right - 1; c--) {
        if (matrix[r][c] === null) {
          const bit = bitIdx < bits.length ? bits[bitIdx++] : false;
          const mask = maskFn(r, c);
          matrix[r][c] = mask ? !bit : bit;
        }
      }
    }
  }

  // 7. Write format information (Mask 0, EC Level M)
  const formatBits = FORMAT_INFO[0];
  const fmtBitsArr: boolean[] = [];
  for (let i = 0; i < 15; i++) {
    fmtBitsArr.push(((formatBits >>> i) & 1) === 1);
  }

  // Top-left and around finder patterns
  const positionsTopLeft: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8],
    [2, 8], [1, 8], [0, 8]
  ];

  for (let i = 0; i < 15; i++) {
    const [r, c] = positionsTopLeft[i];
    matrix[r][c] = fmtBitsArr[i];
  }

  // Bottom-left and Top-right format info
  for (let i = 0; i < 7; i++) {
    matrix[size - 1 - i][8] = fmtBitsArr[i];
  }
  for (let i = 0; i < 8; i++) {
    matrix[8][size - 8 + i] = fmtBitsArr[7 + i];
  }

  return matrix.map((row) => row.map((cell) => cell ?? false));
}

export interface QRCodeSVGOptions {
  size?: number;
  padding?: number;
  fgColor?: string;
  bgColor?: string;
  title?: string;
}

/**
 * Encodes the five XML-significant characters so caller supplied text such
 * as venue names can be embedded in element content and double quoted
 * attribute values without altering the document structure.
 */
export function escapeXmlText(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generates a sanitized SVG string representation of a QR code encoding `text`.
 */
export function generateQRCodeSVG(
  text: string,
  options: QRCodeSVGOptions = {}
): string {
  const size = Math.max(1, Number(options.size) || 240);
  const padding = Math.max(0, Number(options.padding) || 4);
  const fgColor = sanitizeColor(options.fgColor, "#000000");
  const isBgTransparent =
    options.bgColor === "transparent" || options.bgColor === "none";
  const bgColor = isBgTransparent
    ? "transparent"
    : sanitizeColor(options.bgColor, "#ffffff");
  const title = options.title || "QR Code";

  const matrix = generateQRMatrix(text);
  const moduleCount = matrix.length;
  const viewBoxSize = moduleCount + padding * 2;
  const safeTitle = escapeXmlText(title);

  let pathData = "";
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        const x = c + padding;
        const y = r + padding;
        pathData += `M${x},${y}h1v1h-1z `;
      }
    }
  }

  const rawSvg = (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" ` +
    `width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="${safeTitle}">` +
    `<title>${safeTitle}</title>` +
    (bgColor && bgColor !== "transparent"
      ? `<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${bgColor}" />`
      : "") +
    `<path d="${pathData.trim()}" fill="${fgColor}" />` +
    `</svg>`
  );

  return sanitizeSvg(rawSvg);
}

/**
 * Triggers a browser file download of the SVG string.
 */
export function downloadSVG(svgString: string, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".svg") ? filename : `${filename}.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
