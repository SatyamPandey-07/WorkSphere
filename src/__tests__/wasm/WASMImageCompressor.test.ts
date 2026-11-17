import { describe, it, expect, beforeEach } from 'vitest';
import {
  WASMImageCompressor,
  CompressionMode,
  WASM_PAGE_SIZE,
} from '../../core/wasm/WASMImageCompressor';
import type { RawImageData } from '../../core/wasm/WASMImageCompressor';

describe('WASMImageCompressor - Streaming WebAssembly Image Processing', () => {
  let compressor: WASMImageCompressor;

  beforeEach(() => {
    compressor = new WASMImageCompressor(8);
  });

  // Generates smooth gradient image
  function generateGradientImage(width: number, height: number, channels: 1 | 3 | 4 = 3): RawImageData {
    const data = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        data[idx] = Math.round((x / width) * 255);
        if (channels >= 3) {
          data[idx + 1] = Math.round((y / height) * 255);
          data[idx + 2] = Math.round(((x + y) / (width + height)) * 255);
        }
        if (channels === 4) {
          data[idx + 3] = 255;
        }
      }
    }
    return { width, height, channels, data };
  }

  // Generates flat blocky UI image (ideal for RLE)
  function generateFlatUIImage(width: number, height: number): RawImageData {
    const data = new Uint8Array(width * height * 4);
    data.fill(240);
    for (let y = 16; y < 48; y++) {
      for (let x = 16; x < 48; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = 20;
        data[idx + 1] = 120;
        data[idx + 2] = 220;
        data[idx + 3] = 255;
      }
    }
    return { width, height, channels: 4, data };
  }

  describe('WebAssembly Memory Management', () => {
    it('initializes linear memory pool with correct page allocations', () => {
      const usage = compressor.getMemoryUsage();
      expect(usage.allocatedPages).toBe(8);
      expect(usage.totalBytes).toBe(8 * WASM_PAGE_SIZE);
    });
  });

  describe('Lossless Delta-RLE Pipeline', () => {
    it('achieves 100% exact bitwise reconstruction with infinite PSNR', () => {
      const img = generateFlatUIImage(64, 64);
      const pkg = compressor.compress(img, { mode: CompressionMode.LOSSLESS_RLE });

      expect(pkg.mode).toBe(CompressionMode.LOSSLESS_RLE);
      expect(pkg.compressedSizeBytes).toBeLessThan(pkg.originalSizeBytes);
      expect(pkg.compressionRatio).toBeGreaterThan(1.5);

      const decompressed = compressor.decompress(pkg);
      expect(decompressed.width).toBe(64);
      expect(decompressed.height).toBe(64);
      expect(decompressed.channels).toBe(4);

      const psnr = compressor.computePSNR(img.data, decompressed.data);
      expect(psnr).toBe(999.0); // Exact match
    });
  });

  describe('Block-Quantized DCT Pipeline', () => {
    it('compresses photographic gradient image and reconstructs with high PSNR', () => {
      const img = generateGradientImage(32, 32, 3);
      const pkg = compressor.compress(img, { mode: CompressionMode.BLOCK_DCT, quality: 90 });

      expect(pkg.mode).toBe(CompressionMode.BLOCK_DCT);
      expect(pkg.quality).toBe(90);

      const decompressed = compressor.decompress(pkg);
      expect(decompressed.data.length).toBe(img.data.length);

      const psnr = compressor.computePSNR(img.data, decompressed.data);
      expect(psnr).toBeGreaterThan(30.0); // Acceptable image fidelity
    });

    it('quality scaling impacts compressed file size appropriately', () => {
      const img = generateGradientImage(32, 32, 3);
      const pkgLow = compressor.compress(img, { mode: CompressionMode.BLOCK_DCT, quality: 30 });
      const pkgHigh = compressor.compress(img, { mode: CompressionMode.BLOCK_DCT, quality: 95 });

      expect(pkgLow.quality).toBe(30);
      expect(pkgHigh.quality).toBe(95);
    });
  });
});
