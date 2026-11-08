import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exportCanvasAsPng,
  exportCanvasToBlob,
  type CanvasExportOptions,
} from "@/lib/whiteboard/canvasExport";
import type { ShapeData } from "@/hooks/useCanvasWhiteboard";

describe("canvasExport DPI Quality Scaling (1x, 2x, 4x) (#5632)", () => {
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleShapes: ShapeData[] = [
    {
      id: "pen-1",
      type: "pen",
      points: [0, 0, 100, 100],
      color: "#ffffff",
      width: 2,
    },
  ];

  it.each([1, 2, 4] as const)(
    "scales canvas dimensions and transform matrix matching requested pixelRatio: %sx",
    async (ratio) => {
      let createdCanvas: HTMLCanvasElement | null = null;
      let scaleArgs: [number, number] | null = null;

      vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const el = originalCreateElement(tagName);
        if (tagName === "canvas") {
          createdCanvas = el as HTMLCanvasElement;
          const origGetContext = el.getContext.bind(el);
          vi.spyOn(el, "getContext").mockImplementation((contextId: string, options?: any) => {
            const ctx = origGetContext(contextId, options);
            if (ctx && contextId === "2d") {
              const origScale = (ctx as CanvasRenderingContext2D).scale.bind(ctx);
              vi.spyOn(ctx as CanvasRenderingContext2D, "scale").mockImplementation(
                (sx: number, sy: number) => {
                  scaleArgs = [sx, sy];
                  origScale(sx, sy);
                }
              );
            }
            return ctx;
          });
          // Mock toBlob to succeed
          el.toBlob = vi.fn((callback: BlobCallback) => {
            callback(new Blob(["mock-image-data"], { type: "image/png" }));
          });
        }
        return el;
      });

      const options: CanvasExportOptions = {
        width: 200,
        height: 150,
        pixelRatio: ratio,
      };

      await exportCanvasAsPng(sampleShapes, options);

      expect(createdCanvas).not.toBeNull();
      expect((createdCanvas as any).width).toBe(200 * ratio);
      expect((createdCanvas as any).height).toBe(150 * ratio);
      expect(scaleArgs).toEqual([ratio, ratio]);
    }
  );

  it("scales canvas dimensions appropriately when exportCanvasToBlob is called with pixelRatio 4", async () => {
    let createdCanvas: HTMLCanvasElement | null = null;

    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "canvas") {
        createdCanvas = el as HTMLCanvasElement;
        el.toBlob = vi.fn((callback: BlobCallback) => {
          callback(new Blob(["mock-blob"], { type: "image/png" }));
        });
      }
      return el;
    });

    const options: CanvasExportOptions = {
      width: 300,
      height: 200,
      pixelRatio: 4,
    };

    await exportCanvasToBlob(sampleShapes, options);

    expect(createdCanvas).not.toBeNull();
    expect((createdCanvas as any).width).toBe(1200);
    expect((createdCanvas as any).height).toBe(800);
  });
});
