import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exportCanvasAsPng,
  exportCanvasToBlob,
} from "@/lib/whiteboard/canvasExport";
import type { ShapeData } from "@/hooks/useCanvasWhiteboard";

describe("canvasExport null 2D context handling", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  let eventDispatched = false;
  let eventDetail: any = null;

  beforeEach(() => {
    eventDispatched = false;
    eventDetail = null;

    if (typeof window !== "undefined") {
      window.addEventListener("whiteboard:export-error", (e: any) => {
        eventDispatched = true;
        eventDetail = e.detail;
      });
    }
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
  });

  const sampleShapes: ShapeData[] = [
    {
      id: "shape-1",
      type: "pen",
      points: [10, 10, 20, 20],
      color: "#ff0000",
      width: 2,
    },
  ];

  it("handles null context in exportCanvasAsPng without throwing TypeError and emits export error notification", async () => {
    // Mock getContext to return null simulating context allocation failure
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as any);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await exportCanvasAsPng(sampleShapes);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(eventDispatched).toBe(true);
    expect(eventDetail?.message).toContain("Failed to acquire 2D rendering context");
  });

  it("rejects with descriptive Error in exportCanvasToBlob when getContext('2d') returns null", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as any);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(exportCanvasToBlob(sampleShapes)).rejects.toThrow(
      "Failed to acquire 2D rendering context from canvas: getContext('2d') returned null"
    );

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(eventDispatched).toBe(true);
  });
});
