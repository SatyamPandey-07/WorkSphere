import {
  formatFileSize,
  calculateFitDimensions,
  compressImage,
  getImageDimensions,
} from "@/lib/media/imageCompressor";

describe("imageCompressor utility", () => {
  describe("formatFileSize", () => {
    it("formats 0 and negative bytes correctly", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(-10)).toBe("0 B");
    });

    it("formats bytes under 1KB", () => {
      expect(formatFileSize(512)).toBe("512 B");
      expect(formatFileSize(1023)).toBe("1023 B");
    });

    it("formats kilobytes correctly", () => {
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(51200)).toBe("50.0 KB");
      expect(formatFileSize(1048575)).toBe("1024.0 KB");
    });

    it("formats megabytes correctly", () => {
      expect(formatFileSize(1048576)).toBe("1.00 MB");
      expect(formatFileSize(5242880)).toBe("5.00 MB");
    });
  });

  describe("calculateFitDimensions", () => {
    it("returns original dimensions if smaller than max limits", () => {
      const result = calculateFitDimensions(800, 600, 1920, 1080);
      expect(result).toEqual({ width: 800, height: 600 });
    });

    it("scales down width when width exceeds maxWidth", () => {
      const result = calculateFitDimensions(3840, 2160, 1920, 1080);
      expect(result).toEqual({ width: 1920, height: 1080 });
    });

    it("scales down proportionally when height exceeds maxHeight", () => {
      const result = calculateFitDimensions(1000, 2000, 1920, 1000);
      expect(result).toEqual({ width: 500, height: 1000 });
    });

    it("handles zero or negative dimensions safely", () => {
      const result = calculateFitDimensions(0, 0, 1920, 1080);
      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBeGreaterThanOrEqual(1);
    });
  });

  describe("compressImage and DOM mocks", () => {
    let originalCreateElement: typeof document.createElement;
    let originalURL: typeof URL;

    beforeAll(() => {
      originalCreateElement = document.createElement.bind(document);
      originalURL = global.URL;

      // Mock URL.createObjectURL and revokeObjectURL
      global.URL.createObjectURL = jest.fn(() => "blob:mock-preview-url");
      global.URL.revokeObjectURL = jest.fn();

      // Mock Image constructor in jsdom
      class MockImage {
        src = "";
        naturalWidth = 1200;
        naturalHeight = 800;
        width = 1200;
        height = 800;
        onload: (() => void) | null = null;
        onerror: ((err: any) => void) | null = null;

        constructor() {
          setTimeout(() => {
            if (this.onload) this.onload();
          }, 5);
        }
      }

      (global as any).Image = MockImage;
    });

    afterAll(() => {
      document.createElement = originalCreateElement;
      global.URL = originalURL;
    });

    it("extracts dimensions using getImageDimensions", async () => {
      const dummyFile = new File(["dummy content"], "photo.jpg", {
        type: "image/jpeg",
      });
      const dims = await getImageDimensions(dummyFile);
      expect(dims.width).toBe(1200);
      expect(dims.height).toBe(800);
    });

    it("compresses and rotates image with canvas context", async () => {
      const mockContext = {
        fillStyle: "",
        fillRect: jest.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        save: jest.fn(),
        translate: jest.fn(),
        rotate: jest.fn(),
        drawImage: jest.fn(),
        restore: jest.fn(),
      };

      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: jest.fn(() => mockContext),
        toDataURL: jest.fn(() => "data:image/jpeg;base64,dGVzdA=="),
        toBlob: jest.fn((cb: any, type: string) => {
          cb(new Blob(["mock-compressed-bytes"], { type }));
        }),
      };

      jest
        .spyOn(document, "createElement")
        .mockImplementation((tagName: string) => {
          if (tagName === "canvas") {
            return mockCanvas as any;
          }
          return originalCreateElement(tagName);
        });

      const dummyFile = new File(["original-bytes-data"], "travel.jpg", {
        type: "image/jpeg",
      });

      const result = await compressImage(dummyFile, {
        rotation: 90,
        crop: { x: 0, y: 0, width: 800, height: 800 },
        quality: 0.8,
      });

      expect(result).toBeDefined();
      expect(result.dataUrl).toContain("data:image/jpeg");
      expect(result.mimeType).toBe("image/jpeg");
      expect(mockContext.rotate).toHaveBeenCalledWith((90 * Math.PI) / 180);
      expect(mockContext.drawImage).toHaveBeenCalled();
      expect(result.sizeBytes).toBeGreaterThan(0);
    });
  });
});
