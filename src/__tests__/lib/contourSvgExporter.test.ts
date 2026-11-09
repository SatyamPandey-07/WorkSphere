import {
  contourToSvgPathData,
  generateFloorplanSvg,
  downloadFloorplanSvg,
  type ContourPolygon,
  type ContourSvgExportOptions,
  CONTOUR_STROKE_PRESETS,
  CONTOUR_STROKE_WIDTHS,
} from "@/lib/floorplan/contourSvgExporter";

describe("Contour SVG Exporter (#5392)", () => {
  const samplePolygon1: ContourPolygon = [
    { x: 10, y: 10 },
    { x: 100, y: 10 },
    { x: 100, y: 100 },
    { x: 10, y: 10 },
  ];

  const samplePolygon2: ContourPolygon = [
    { x: 150, y: 150 },
    { x: 250, y: 150 },
    { x: 250, y: 250 },
    { x: 150, y: 250 },
  ];

  describe("contourToSvgPathData", () => {
    it("converts pixel coordinate points to an SVG path string", () => {
      const d = contourToSvgPathData(samplePolygon1, 800, 600);
      expect(d).toBe("M 10 10 L 100 10 L 100 100 L 10 10 Z");
    });

    it("normalizes coordinates when normalize option is true", () => {
      const d = contourToSvgPathData(samplePolygon1, 1000, 500, {
        normalize: true,
        precision: 3,
      });
      // 10 / 1000 = 0.01, 10 / 500 = 0.02
      expect(d).toContain("M 0.01 0.02");
      expect(d.endsWith("Z")).toBe(true);
    });

    it("returns empty string for empty polygon", () => {
      expect(contourToSvgPathData([], 800, 600)).toBe("");
    });
  });

  describe("generateFloorplanSvg", () => {
    it("generates a valid SVG document with metadata and path elements", () => {
      const svg = generateFloorplanSvg(
        [samplePolygon1, samplePolygon2],
        800,
        600,
        "venue-101"
      );

      expect(svg).toContain(`<?xml version="1.0" encoding="UTF-8"?>`);
      expect(svg).toContain(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">`);
      expect(svg).toContain(`<!-- Venue: venue-101 | Contours: 2 | ViewBox: 0 0 800 600 -->`);
      expect(svg).toContain(`<path id="contour-1" d="M 10 10 L 100 10 L 100 100 L 10 10 Z"`);
      expect(svg).toContain(`<path id="contour-2" d="M 150 150 L 250 150 L 250 250 L 150 250 Z"`);
      expect(svg).toContain(`</svg>`);
    });

    it("applies custom styling options", () => {
      const svg = generateFloorplanSvg([samplePolygon1], 800, 600, "venue-test", {
        strokeColor: "#ff0000",
        strokeWidth: 4,
        fillColor: "rgba(255, 0, 0, 0.2)",
      });

      expect(svg).toContain(`stroke="#ff0000"`);
      expect(svg).toContain(`stroke-width="4"`);
      expect(svg).toContain(`fill="rgba(255, 0, 0, 0.2)"`);
    });

    it("supports ContourSvgExportOptions with strokeColor presets (#5767)", () => {
      // Test Blueprint Blue swatch
      const blueprintSvg = generateFloorplanSvg(
        [samplePolygon1],
        800,
        600,
        "venue-blueprint",
        {
          strokeColor: CONTOUR_STROKE_PRESETS.blueprintBlue.strokeColor,
          strokeWidth: 2,
          fillColor: CONTOUR_STROKE_PRESETS.blueprintBlue.fillColor,
        }
      );
      expect(blueprintSvg).toContain(`stroke="#0284c7"`);
      expect(blueprintSvg).toContain(`stroke-width="2"`);
      expect(blueprintSvg).toContain(`fill="rgba(14, 165, 233, 0.15)"`);

      // Test Emerald Green swatch
      const emeraldSvg = generateFloorplanSvg(
        [samplePolygon1],
        800,
        600,
        "venue-emerald",
        {
          strokeColor: CONTOUR_STROKE_PRESETS.emeraldGreen.strokeColor,
          strokeWidth: 3,
          fillColor: CONTOUR_STROKE_PRESETS.emeraldGreen.fillColor,
        }
      );
      expect(emeraldSvg).toContain(`stroke="#059669"`);
      expect(emeraldSvg).toContain(`stroke-width="3"`);
      expect(emeraldSvg).toContain(`fill="rgba(16, 185, 129, 0.15)"`);

      // Test Minimalist Charcoal swatch
      const charcoalSvg = generateFloorplanSvg(
        [samplePolygon1],
        800,
        600,
        "venue-charcoal",
        {
          strokeColor: CONTOUR_STROKE_PRESETS.minimalistCharcoal.strokeColor,
          strokeWidth: 1,
          fillColor: CONTOUR_STROKE_PRESETS.minimalistCharcoal.fillColor,
        }
      );
      expect(charcoalSvg).toContain(`stroke="#334155"`);
      expect(charcoalSvg).toContain(`stroke-width="1"`);
      expect(charcoalSvg).toContain(`fill="rgba(51, 65, 85, 0.15)"`);
    });

    it("supports custom stroke widths between 1px and 4px (#5767)", () => {
      CONTOUR_STROKE_WIDTHS.forEach((width) => {
        const svg = generateFloorplanSvg(
          [samplePolygon1],
          800,
          600,
          "venue-width-test",
          {
            strokeWidth: width,
          }
        );
        expect(svg).toContain(`stroke-width="${width}"`);
      });
    });
  });

  describe("downloadFloorplanSvg", () => {
    it("generates correctly formatted filename [venueId]-floorplan-vector.svg", () => {
      // Mock window and document for unit test environment
      const originalCreateElement = document.createElement;
      const originalBlob = global.Blob;
      const originalURL = global.URL;

      const mockClick = jest.fn();
      const mockAppendChild = jest.fn();
      const mockRemoveChild = jest.fn();

      document.createElement = jest.fn((tag) => {
        if (tag === "a") {
          return {
            href: "",
            download: "",
            click: mockClick,
          } as unknown as HTMLElement;
        }
        return originalCreateElement.call(document, tag);
      });

      document.body.appendChild = mockAppendChild;
      document.body.removeChild = mockRemoveChild;

      global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
      global.URL.revokeObjectURL = jest.fn();

      const filename = downloadFloorplanSvg(
        [samplePolygon1],
        800,
        600,
        "venue-austin-05"
      );

      expect(filename).toBe("venue-austin-05-floorplan-vector.svg");
      expect(mockClick).toHaveBeenCalled();

      // Restore
      document.createElement = originalCreateElement;
      global.Blob = originalBlob;
      global.URL = originalURL;
    });
  });

  describe("Degenerate and Zero-Length Contour Filtering (#5735)", () => {
    it("filters out single-pixel artifacts with identical points", () => {
      const singlePixelContour: ContourPolygon = [
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
      ];

      const d = contourToSvgPathData(singlePixelContour, 800, 600);
      expect(d).toBe("");
    });

    it("filters out contours with fewer than 3 points", () => {
      const singlePoint: ContourPolygon = [{ x: 20, y: 20 }];
      const twoPoints: ContourPolygon = [
        { x: 20, y: 20 },
        { x: 21, y: 20 },
      ];

      expect(contourToSvgPathData(singlePoint, 800, 600)).toBe("");
      expect(contourToSvgPathData(twoPoints, 800, 600)).toBe("");
    });

    it("filters out contours with perimeter below threshold (< 10px)", () => {
      // Small 1x1 pixel box: perimeter = 1 + 1 + 1 + 1 = 4px (< 10px threshold)
      const tinyNoiseBox: ContourPolygon = [
        { x: 10, y: 10 },
        { x: 11, y: 10 },
        { x: 11, y: 11 },
        { x: 10, y: 11 },
      ];

      const d = contourToSvgPathData(tinyNoiseBox, 800, 600);
      expect(d).toBe("");
    });

    it("eliminates noise contours and preserves valid room contours in generateFloorplanSvg", () => {
      const validRoom: ContourPolygon = [
        { x: 50, y: 50 },
        { x: 200, y: 50 },
        { x: 200, y: 150 },
        { x: 50, y: 150 },
      ];
      const singlePixelNoise: ContourPolygon = [
        { x: 300, y: 300 },
        { x: 300, y: 300 },
      ];
      const tinyArtifact: ContourPolygon = [
        { x: 400, y: 400 },
        { x: 401, y: 400 },
        { x: 401, y: 401 },
        { x: 400, y: 401 },
      ];

      const svg = generateFloorplanSvg(
        [validRoom, singlePixelNoise, tinyArtifact],
        800,
        600,
        "venue-clean-test"
      );

      // Only validRoom should be included
      expect(svg).toContain(`<!-- Venue: venue-clean-test | Contours: 1 | ViewBox: 0 0 800 600 -->`);
      expect(svg).toContain(`id="contour-1"`);
      expect(svg).not.toContain(`id="contour-2"`);
      expect(svg).not.toContain(`id="contour-3"`);
    });

    it("allows custom minPerimeter override", () => {
      // Box with perimeter 12px
      const smallBox: ContourPolygon = [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ];

      // Default minPerimeter is 10px, so 12px passes
      expect(contourToSvgPathData(smallBox, 800, 600)).not.toBe("");

      // Strict minPerimeter of 20px filters it out
      expect(
        contourToSvgPathData(smallBox, 800, 600, { minPerimeter: 20 })
      ).toBe("");
    });
  });
});
