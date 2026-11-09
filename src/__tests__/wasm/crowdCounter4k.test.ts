import { describe, it, expect } from "@jest/globals";
import {
  validateBoundingBox,
  calculateBlobArea,
  calculateBlobAreaInt16Legacy,
  filterBlobByArea,
  extractCrowdBlobs,
  countCrowdBlobs,
} from "@/lib/wasm-loader/crowdCounter";

describe("crowd_counter.c 4K Video Stream uint32_t Area & Resolution Bounds", () => {
  const FRAME_4K_WIDTH = 3840;
  const FRAME_4K_HEIGHT = 2160;

  describe("32-Bit Unsigned Area Calculation vs 16-Bit Overflow Prevention", () => {
    it("calculates accurate uint32_t area for large 4K bounding boxes where int16_t overflows to negative", () => {
      // 250x200 bounding box (common for people clusters or groups in 4K streams)
      const boxW = 250;
      const boxH = 200;
      const expectedArea = 50000;

      const uint32Area = calculateBlobArea(boxW, boxH);
      const int16LegacyArea = calculateBlobAreaInt16Legacy(boxW, boxH);

      // In int16_t (signed 16-bit), 50,000 wraps around to negative (-15,536)
      expect(int16LegacyArea).toBeLessThan(0);
      expect(int16LegacyArea).toBe(-15536);

      // In uint32_t, 50,000 is accurately calculated without overflow
      expect(uint32Area).toBe(expectedArea);
      expect(uint32Area).toBe(50000);
    });

    it("accurately calculates areas across medium, large, and full 4K frame resolutions", () => {
      // Medium cluster: 500x100 = 50,000 (int16_t: -15,536)
      expect(calculateBlobArea(500, 100)).toBe(50000);
      expect(calculateBlobAreaInt16Legacy(500, 100)).toBe(-15536);

      // Large cluster: 400x400 = 160,000
      expect(calculateBlobArea(400, 400)).toBe(160000);

      // Multi-person queue group: 1200x800 = 960,000
      expect(calculateBlobArea(1200, 800)).toBe(960000);

      // Full 4K frame: 3840x2160 = 8,294,400
      expect(calculateBlobArea(FRAME_4K_WIDTH, FRAME_4K_HEIGHT)).toBe(8294400);
    });

    it("prevents oversized blobs from bypassing threshold filters due to negative 16-bit wrap-around", () => {
      // Bounding box: 300x300 (Area = 90,000)
      const boxW = 300;
      const boxH = 300;
      const minArea = 500;
      const maxArea = 25000; // Threshold intended to filter out oversized non-human blobs

      // Vulnerability demonstration: With legacy int16_t, -24536 <= maxArea (25000) is TRUE!
      const legacyArea = calculateBlobAreaInt16Legacy(boxW, boxH);
      expect(legacyArea <= maxArea).toBe(true); // Demonstrates bypass of upper threshold filter

      // With uint32_t, the area is 90,000 which correctly exceeds maxArea (25,000)
      const filterResult = filterBlobByArea(boxW, boxH, minArea, maxArea);
      expect(filterResult.area).toBe(90000);
      expect(filterResult.valid).toBe(false); // Properly rejected as oversized
    });

    it("correctly accepts valid human-scale blobs in 4K resolution within threshold limits", () => {
      // Human-scale blob in 4K: 80x200 = 16,000
      const filterResult = filterBlobByArea(80, 200, 2000, 30000);
      expect(filterResult.area).toBe(16000);
      expect(filterResult.valid).toBe(true);
    });
  });

  describe("Sanity Check Rejecting Bounding Boxes Exceeding Frame Resolution", () => {
    it("accepts valid bounding boxes strictly inside 4K frame bounds", () => {
      // Valid interior box
      expect(
        validateBoundingBox(
          100,
          200,
          500,
          800,
          FRAME_4K_WIDTH,
          FRAME_4K_HEIGHT,
        ),
      ).toBe(true);

      // Valid boundary edge box touching top-left (0, 0)
      expect(
        validateBoundingBox(0, 0, 100, 150, FRAME_4K_WIDTH, FRAME_4K_HEIGHT),
      ).toBe(true);

      // Valid boundary edge box touching bottom-right (3839, 2159)
      expect(
        validateBoundingBox(
          3700,
          2000,
          FRAME_4K_WIDTH - 1,
          FRAME_4K_HEIGHT - 1,
          FRAME_4K_WIDTH,
          FRAME_4K_HEIGHT,
        ),
      ).toBe(true);
    });

    it("rejects bounding boxes extending past 4K frame width (xMax >= 3840)", () => {
      expect(
        validateBoundingBox(
          3500,
          100,
          3840,
          500,
          FRAME_4K_WIDTH,
          FRAME_4K_HEIGHT,
        ),
      ).toBe(false);

      expect(
        validateBoundingBox(
          3500,
          100,
          4000,
          500,
          FRAME_4K_WIDTH,
          FRAME_4K_HEIGHT,
        ),
      ).toBe(false);
    });

    it("rejects bounding boxes extending past 4K frame height (yMax >= 2160)", () => {
      expect(
        validateBoundingBox(
          100,
          2000,
          300,
          2160,
          FRAME_4K_WIDTH,
          FRAME_4K_HEIGHT,
        ),
      ).toBe(false);

      expect(
        validateBoundingBox(
          100,
          2000,
          300,
          2500,
          FRAME_4K_WIDTH,
          FRAME_4K_HEIGHT,
        ),
      ).toBe(false);
    });

    it("rejects inverted or negative bounding box coordinates", () => {
      // Inverted x: xMin > xMax
      expect(
        validateBoundingBox(
          500,
          100,
          200,
          300,
          FRAME_4K_WIDTH,
          FRAME_4K_HEIGHT,
        ),
      ).toBe(false);

      // Inverted y: yMin > yMax
      expect(
        validateBoundingBox(
          100,
          600,
          300,
          200,
          FRAME_4K_WIDTH,
          FRAME_4K_HEIGHT,
        ),
      ).toBe(false);

      // Negative coordinates
      expect(
        validateBoundingBox(-10, 50, 100, 200, FRAME_4K_WIDTH, FRAME_4K_HEIGHT),
      ).toBe(false);
    });

    it("rejects bounding boxes with zero or invalid frame dimensions", () => {
      expect(validateBoundingBox(10, 10, 50, 50, 0, 2160)).toBe(false);
      expect(validateBoundingBox(10, 10, 50, 50, 3840, 0)).toBe(false);
      expect(validateBoundingBox(10, 10, 50, 50, -1, -1)).toBe(false);
    });
  });

  describe("Processing Simulated 4K (3840x2160) Frame Buffers", () => {
    it("isolates and extracts distinct crowd blobs across a simulated 4K frame buffer", () => {
      // Create a sparse simulated 4K mask (represented efficiently with coordinates)
      // To simulate full 4K connected component labeling, we create coordinate clusters
      const width = FRAME_4K_WIDTH;

      // Define 3 simulated human blobs in 4K coordinate space
      // Blob 1: Standing nomad at (400, 300), size 40x80 (Area = 3,200)
      // Blob 2: Person walking at (2000, 1000), size 60x120 (Area = 7,200)
      // Blob 3: Large conference table cluster at (3000, 1500), size 300x200 (Area = 60,000)

      // Test a 4K sub-grid / slice buffer containing these distinct blobs
      const testH = 300;
      const maskSlice = new Uint8Array(width * testH);

      // Draw Blob A: (400, 20) to (440, 99) -> w = 41, h = 80, area = 3280
      for (let y = 20; y < 100; y++) {
        for (let x = 400; x <= 440; x++) {
          maskSlice[y * width + x] = 1;
        }
      }

      // Draw Blob B: (2000, 50) to (2059, 169) -> w = 60, h = 120, area = 7200
      for (let y = 50; y < 170; y++) {
        for (let x = 2000; x < 2060; x++) {
          maskSlice[y * width + x] = 1;
        }
      }

      const result = extractCrowdBlobs(maskSlice, width, testH, 1000, 50000);

      expect(result.count).toBe(2);
      expect(result.blobs).toHaveLength(2);

      const blobA = result.blobs.find((b) => b.xMin === 400);
      const blobB = result.blobs.find((b) => b.xMin === 2000);

      expect(blobA).toBeDefined();
      expect(blobA?.width).toBe(41);
      expect(blobA?.height).toBe(80);
      expect(blobA?.area).toBe(41 * 80);

      expect(blobB).toBeDefined();
      expect(blobB?.width).toBe(60);
      expect(blobB?.height).toBe(120);
      expect(blobB?.area).toBe(7200);
    });

    it("correctly filters out massive 4K background noise (> 50,000 area) without integer overflow", () => {
      const width = FRAME_4K_WIDTH;
      const height = 250;
      const maskSlice = new Uint8Array(width * height);

      // Inject a normal person blob (50x80 = 4,000)
      for (let y = 20; y < 100; y++) {
        for (let x = 100; x < 150; x++) {
          maskSlice[y * width + x] = 1;
        }
      }

      // Inject a massive cluster / sunlight glare artifact: 350x200 (Area = 70,000)
      // In 16-bit signed integer, 70,000 would overflow to +4,464 and falsely pass an upper limit of 20,000!
      for (let y = 20; y < 220; y++) {
        for (let x = 1000; x < 1350; x++) {
          maskSlice[y * width + x] = 1;
        }
      }

      // Threshold: only accept blobs between 1,000 and 20,000
      const result = extractCrowdBlobs(maskSlice, width, height, 1000, 20000);

      // Only the person blob (area 4,000) must be accepted; the 70,000 area blob must be rejected!
      expect(result.count).toBe(1);
      expect(result.blobs[0].area).toBe(50 * 80);
      expect(result.blobs[0].xMin).toBe(100);
    });

    it("counts crowd blobs accurately in 4K frame buffer via countCrowdBlobs convenience function", () => {
      const width = FRAME_4K_WIDTH;
      const height = 150;
      const maskSlice = new Uint8Array(width * height);

      // 4 distinct people at intervals
      const xPositions = [200, 800, 1800, 3200];
      for (const startX of xPositions) {
        for (let y = 20; y < 80; y++) {
          for (let x = startX; x < startX + 30; x++) {
            maskSlice[y * width + x] = 1;
          }
        }
      }

      const count = countCrowdBlobs(maskSlice, width, height, 500, 5000);
      expect(count).toBe(4);
    });
  });
});
