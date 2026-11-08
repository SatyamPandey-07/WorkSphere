import {
  quantizeStrokePoints,
  dequantizeStrokePoints,
  dequantizeToPointObjects,
  calculateMaxCoordinateDeviation,
  calculateBandwidthSavings,
  packQuantizedStrokeToInt16,
  unpackInt16ToQuantizedStroke,
  encodeStrokeToBinary,
  decodeStrokeFromBinary,
  DEFAULT_QUANTIZATION_SCALE,
  Point2D,
} from "@/lib/whiteboard/strokeCompression";

describe("Whiteboard Delta Stroke Vector Quantization (#6479)", () => {
  // Realistic floating-point mouse trajectory sampled across an SVG canvas
  const sampleStrokeFloating: number[] = [
    124.38291, 230.91823,
    125.71924, 233.10294,
    128.45291, 236.88219,
    132.19382, 241.02934,
    137.89201, 246.39201,
    144.59281, 252.19382,
    152.01923, 258.91029,
    160.82910, 266.39102,
    170.29102, 274.19201,
    180.49201, 282.88201,
  ];

  describe("Quantization and Dequantization Core", () => {
    it("quantizes and dequantizes continuous SVG stroke points accurately", () => {
      const quantized = quantizeStrokePoints(sampleStrokeFloating);

      expect(quantized.pointCount).toBe(10);
      expect(quantized.scale).toBe(DEFAULT_QUANTIZATION_SCALE);
      expect(quantized.originX).toBe(Math.round(sampleStrokeFloating[0] * DEFAULT_QUANTIZATION_SCALE));
      expect(quantized.originY).toBe(Math.round(sampleStrokeFloating[1] * DEFAULT_QUANTIZATION_SCALE));
      expect(quantized.deltas.length).toBe(18); // 9 points * 2 (dx, dy)

      const reconstructed = dequantizeStrokePoints(quantized);
      expect(reconstructed.length).toBe(sampleStrokeFloating.length);

      // Verify origin point matches within 0.05px
      expect(Math.abs(reconstructed[0] - sampleStrokeFloating[0])).toBeLessThanOrEqual(0.05);
      expect(Math.abs(reconstructed[1] - sampleStrokeFloating[1])).toBeLessThanOrEqual(0.05);
    });

    it("preserves sub-pixel drawing fidelity with max coordinate deviation < 0.5px", () => {
      const quantized = quantizeStrokePoints(sampleStrokeFloating);
      const reconstructed = dequantizeStrokePoints(quantized);

      const maxDeviation = calculateMaxCoordinateDeviation(sampleStrokeFloating, reconstructed);

      // Strictly fulfills acceptance criteria: max coordinate deviation < 0.5px
      expect(maxDeviation).toBeLessThan(0.5);
      // At scale 10.0, max deviation is <= 0.05px
      expect(maxDeviation).toBeLessThanOrEqual(0.05);
    });

    it("supports Point2D object array input format [{x, y}]", () => {
      const pointObjects: Point2D[] = [
        { x: 50.45, y: 100.82 },
        { x: 55.19, y: 104.38 },
        { x: 61.92, y: 109.11 },
      ];

      const quantized = quantizeStrokePoints(pointObjects);
      expect(quantized.pointCount).toBe(3);

      const reconstructedObjects = dequantizeToPointObjects(quantized);
      expect(reconstructedObjects.length).toBe(3);

      expect(Math.abs(reconstructedObjects[0].x - pointObjects[0].x)).toBeLessThan(0.5);
      expect(Math.abs(reconstructedObjects[0].y - pointObjects[0].y)).toBeLessThan(0.5);
      expect(Math.abs(reconstructedObjects[2].x - pointObjects[2].x)).toBeLessThan(0.5);
      expect(Math.abs(reconstructedObjects[2].y - pointObjects[2].y)).toBeLessThan(0.5);
    });
  });

  describe("Bandwidth Reduction (> 70% Savings)", () => {
    it("drops transmission bandwidth by over 70% over raw floating point JSON coordinates", () => {
      // Simulate rapid 100-point pen scribbling with full 64-bit precision telemetry
      const longScribble: number[] = [];
      let curX = 200.12345;
      let curY = 300.98765;

      for (let i = 0; i < 100; i++) {
        curX += Math.sin(i * 0.1) * 3.42189;
        curY += Math.cos(i * 0.1) * 2.89123;
        longScribble.push(curX, curY);
      }

      const quantized = quantizeStrokePoints(longScribble);
      const binary = encodeStrokeToBinary(longScribble);

      const savings = calculateBandwidthSavings(longScribble, binary);

      // Raw JSON string of 200 floats is ~3800 bytes; binary packed Int16 is ~408 bytes
      expect(savings.rawBytes).toBeGreaterThan(2500);
      expect(savings.compressedBytes).toBeLessThan(500);
      expect(savings.savingsPercent).toBeGreaterThan(70.0);

      // Verify that after binary roundtrip, deviation is still < 0.5px
      const decoded = decodeStrokeFromBinary(binary);
      const maxDev = calculateMaxCoordinateDeviation(longScribble, decoded);
      expect(maxDev).toBeLessThan(0.5);
    });
  });

  describe("Binary Int16 Packing & Deserialization", () => {
    it("packs and unpacks quantized stroke using Int16Array buffers without loss", () => {
      const quantized = quantizeStrokePoints(sampleStrokeFloating);
      const packed = packQuantizedStrokeToInt16(quantized);

      expect(packed).toBeInstanceOf(Int16Array);
      expect(packed.length).toBe(4 + quantized.deltas.length);

      const unpacked = unpackInt16ToQuantizedStroke(packed);
      expect(unpacked.pointCount).toBe(quantized.pointCount);
      expect(unpacked.originX).toBe(quantized.originX);
      expect(unpacked.originY).toBe(quantized.originY);
      expect(unpacked.deltas).toEqual(quantized.deltas);

      const reconstructed = dequantizeStrokePoints(unpacked);
      const maxDev = calculateMaxCoordinateDeviation(sampleStrokeFloating, reconstructed);
      expect(maxDev).toBeLessThan(0.5);
    });
  });

  describe("Edge Cases & Rapid Scribble Robustness", () => {
    it("handles empty and single-point strokes gracefully", () => {
      const emptyQuantized = quantizeStrokePoints([]);
      expect(emptyQuantized.pointCount).toBe(0);
      expect(emptyQuantized.deltas).toEqual([]);
      expect(dequantizeStrokePoints(emptyQuantized)).toEqual([]);

      const singlePointQuantized = quantizeStrokePoints([100.5, 200.5]);
      expect(singlePointQuantized.pointCount).toBe(1);
      expect(singlePointQuantized.deltas).toEqual([]);

      const reconstructedSingle = dequantizeStrokePoints(singlePointQuantized);
      expect(reconstructedSingle).toEqual([100.5, 200.5]);
    });

    it("clamps large rapid displacement deltas to 16-bit integer boundaries (-32768 to 32767)", () => {
      // Stroke with massive teleports
      const extremeStroke = [0, 0, 50000, -50000];
      const quantized = quantizeStrokePoints(extremeStroke, { clampToInt16: true });

      for (const d of quantized.deltas) {
        expect(d).toBeGreaterThanOrEqual(-32768);
        expect(d).toBeLessThanOrEqual(32767);
      }
    });
  });
});
