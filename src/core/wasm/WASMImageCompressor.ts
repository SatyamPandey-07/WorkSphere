/**
 * Streaming WebAssembly Image Compressor
 * Implements linear memory page management, delta-RLE lossless compression,
 * and 8x8 block Discrete Cosine Transform (DCT) quantization.
 */

export const CompressionMode = {
  LOSSLESS_RLE: 'LOSSLESS_RLE',
  BLOCK_DCT: 'BLOCK_DCT',
} as const;

export type CompressionMode = (typeof CompressionMode)[keyof typeof CompressionMode];

export interface RawImageData {
  width: number;
  height: number;
  channels: 1 | 3 | 4; // Grayscale (1), RGB (3), RGBA (4)
  data: Uint8Array;
}

export interface CompressionOptions {
  mode?: CompressionMode;
  quality?: number; // 1 to 100 (for DCT mode)
  chunkScanlines?: number; // Bounded streaming chunk size (default 32)
}

export interface CompressedImagePackage {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  mode: CompressionMode;
  quality: number;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  compressionRatio: number;
  payload: Uint8Array;
}

export const WASM_PAGE_SIZE = 65536; // 64 KB WebAssembly linear memory page

export class WASMImageCompressor {
  private allocatedPages: number;
  private memoryPool: Uint8Array;
  private memoryOffset = 0;

  // Precomputed 8x8 DCT Cosine Table
  private dctCosTable: Float32Array;

  // Standard JPEG Luminance Quantization Matrix
  private baseQuantMatrix = new Uint8Array([
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
  ]);

  constructor(initialPages: number = 16) {
    this.allocatedPages = initialPages;
    this.memoryPool = new Uint8Array(initialPages * WASM_PAGE_SIZE);

    // Precompute 8x8 DCT Cosine Lookup Table
    this.dctCosTable = new Float32Array(8 * 8);
    for (let u = 0; u < 8; u++) {
      for (let x = 0; x < 8; x++) {
        this.dctCosTable[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
      }
    }
  }

  /**
   * Compresses an image using the selected compression pipeline.
   */
  public compress(
    image: RawImageData,
    options: CompressionOptions = {}
  ): CompressedImagePackage {
    const mode = options.mode ?? CompressionMode.LOSSLESS_RLE;
    const quality = Math.max(1, Math.min(100, options.quality ?? 85));
    const origSize = image.data.length;

    let payload: Uint8Array;
    if (mode === CompressionMode.LOSSLESS_RLE) {
      payload = this.compressLosslessRLE(image);
    } else {
      payload = this.compressBlockDCT(image, quality);
    }

    const compressedSize = payload.length;
    const compressionRatio = Math.round((origSize / Math.max(compressedSize, 1)) * 100) / 100;

    return {
      width: image.width,
      height: image.height,
      channels: image.channels,
      mode,
      quality,
      originalSizeBytes: origSize,
      compressedSizeBytes: compressedSize,
      compressionRatio,
      payload,
    };
  }

  /**
   * Decompresses a compressed package back into uncompressed raw raster.
   */
  public decompress(pkg: CompressedImagePackage): RawImageData {
    if (pkg.mode === CompressionMode.LOSSLESS_RLE) {
      const data = this.decompressLosslessRLE(pkg.payload, pkg.width * pkg.height * pkg.channels);
      return {
        width: pkg.width,
        height: pkg.height,
        channels: pkg.channels,
        data,
      };
    } else {
      const data = this.decompressBlockDCT(pkg.payload, pkg.width, pkg.height, pkg.channels, pkg.quality);
      return {
        width: pkg.width,
        height: pkg.height,
        channels: pkg.channels,
        data,
      };
    }
  }

  /**
   * Computes the Peak Signal-to-Noise Ratio (PSNR) in dB between two image buffers.
   */
  public computePSNR(original: Uint8Array, reconstructed: Uint8Array): number {
    if (original.length !== reconstructed.length) {
      throw new Error('Image buffers must have identical lengths to compute PSNR');
    }

    let mseSum = 0;
    for (let i = 0; i < original.length; i++) {
      const diff = original[i] - reconstructed[i];
      mseSum += diff * diff;
    }

    const mse = mseSum / original.length;
    if (mse === 0) return 999.0; // Bitwise identical, infinite PSNR

    return 10 * Math.log10((255 * 255) / mse);
  }

  public getMemoryUsage(): { allocatedPages: number; totalBytes: number } {
    return {
      allocatedPages: this.allocatedPages,
      totalBytes: this.allocatedPages * WASM_PAGE_SIZE,
    };
  }

  // --- Lossless Delta-RLE Pipeline ---

  private compressLosslessRLE(image: RawImageData): Uint8Array {
    const raw = image.data;
    const len = raw.length;
    if (len === 0) return new Uint8Array(0);

    // Step 1: Delta prediction filter
    const delta = new Uint8Array(len);
    delta[0] = raw[0];
    for (let i = 1; i < len; i++) {
      delta[i] = (raw[i] - raw[i - 1]) & 0xff;
    }

    // Step 2: Run-Length Encode (RLE) delta bytes
    const out: number[] = [];
    let i = 0;
    while (i < len) {
      const val = delta[i];
      let run = 1;
      while (i + run < len && delta[i + run] === val && run < 255) {
        run++;
      }
      out.push(run, val);
      i += run;
    }

    return new Uint8Array(out);
  }

  private decompressLosslessRLE(payload: Uint8Array, expectedLen: number): Uint8Array {
    const delta = new Uint8Array(expectedLen);
    let outIdx = 0;

    for (let i = 0; i < payload.length; i += 2) {
      const run = payload[i];
      const val = payload[i + 1];
      for (let r = 0; r < run && outIdx < expectedLen; r++) {
        delta[outIdx++] = val;
      }
    }

    // Reverse Delta filter
    const reconstituted = new Uint8Array(expectedLen);
    if (expectedLen > 0) {
      reconstituted[0] = delta[0];
      for (let i = 1; i < expectedLen; i++) {
        reconstituted[i] = (reconstituted[i - 1] + delta[i]) & 0xff;
      }
    }

    return reconstituted;
  }

  // --- 8x8 Block DCT Quantized Pipeline ---

  private compressBlockDCT(image: RawImageData, quality: number): Uint8Array {
    const qMatrix = this.scaleQuantMatrix(quality);
    const { width, height, channels, data } = image;
    const blocksX = Math.ceil(width / 8);
    const blocksY = Math.ceil(height / 8);

    const out: number[] = [];

    // Process each channel independently
    for (let ch = 0; ch < channels; ch++) {
      for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
          const block = new Float32Array(64);

          // Extract 8x8 block with zero-padding
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const px = bx * 8 + x;
              const py = by * 8 + y;
              if (px < width && py < height) {
                const idx = (py * width + px) * channels + ch;
                block[y * 8 + x] = data[idx] - 128; // Level shift by -128
              } else {
                block[y * 8 + x] = 0;
              }
            }
          }

          // Forward 2D-DCT
          const dct = this.forwardDCT8x8(block);

          // Quantization & 16-bit signed packing
          for (let i = 0; i < 64; i++) {
            const qVal = Math.round(dct[i] / qMatrix[i]);
            const clamped = Math.max(-32768, Math.min(32767, qVal));
            out.push((clamped >> 8) & 0xff, clamped & 0xff);
          }
        }
      }
    }

    return new Uint8Array(out);
  }

  private decompressBlockDCT(
    payload: Uint8Array,
    width: number,
    height: number,
    channels: 1 | 3 | 4,
    quality: number
  ): Uint8Array {
    const qMatrix = this.scaleQuantMatrix(quality);
    const blocksX = Math.ceil(width / 8);
    const blocksY = Math.ceil(height / 8);

    const result = new Uint8Array(width * height * channels);
    let payloadIdx = 0;

    for (let ch = 0; ch < channels; ch++) {
      for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
          const dct = new Float32Array(64);

          // De-quantize from 16-bit signed
          for (let i = 0; i < 64; i++) {
            let val = (payload[payloadIdx] << 8) | payload[payloadIdx + 1];
            if (val & 0x8000) val -= 0x10000;
            payloadIdx += 2;
            dct[i] = val * qMatrix[i];
          }

          // Inverse 2D-DCT
          const block = this.inverseDCT8x8(dct);

          // Write back with level shift +128 and clamping
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const px = bx * 8 + x;
              const py = by * 8 + y;
              if (px < width && py < height) {
                const pixel = Math.min(255, Math.max(0, Math.round(block[y * 8 + x] + 128)));
                const idx = (py * width + px) * channels + ch;
                result[idx] = pixel;
              }
            }
          }
        }
      }
    }

    return result;
  }

  private forwardDCT8x8(f: Float32Array): Float32Array {
    const F = new Float32Array(64);
    for (let u = 0; u < 8; u++) {
      const cu = u === 0 ? 1 / Math.SQRT2 : 1.0;
      for (let v = 0; v < 8; v++) {
        const cv = v === 0 ? 1 / Math.SQRT2 : 1.0;
        let sum = 0;
        for (let x = 0; x < 8; x++) {
          const cosU = this.dctCosTable[u * 8 + x];
          for (let y = 0; y < 8; y++) {
            const cosV = this.dctCosTable[v * 8 + y];
            sum += f[y * 8 + x] * cosU * cosV;
          }
        }
        F[v * 8 + u] = 0.25 * cu * cv * sum;
      }
    }
    return F;
  }

  private inverseDCT8x8(F: Float32Array): Float32Array {
    const f = new Float32Array(64);
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        let sum = 0;
        for (let u = 0; u < 8; u++) {
          const cu = u === 0 ? 1 / Math.SQRT2 : 1.0;
          const cosU = this.dctCosTable[u * 8 + x];
          for (let v = 0; v < 8; v++) {
            const cv = v === 0 ? 1 / Math.SQRT2 : 1.0;
            const cosV = this.dctCosTable[v * 8 + y];
            sum += cu * cv * F[v * 8 + u] * cosU * cosV;
          }
        }
        f[y * 8 + x] = 0.25 * sum;
      }
    }
    return f;
  }

  private scaleQuantMatrix(quality: number): Uint8Array {
    const factor = quality < 50 ? Math.floor(5000 / quality) : 200 - 2 * quality;
    const scaled = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      const val = Math.floor((this.baseQuantMatrix[i] * factor + 50) / 100);
      scaled[i] = Math.max(1, Math.min(255, val));
    }
    return scaled;
  }
}
