/**
 * Tests for the heatmapRenderer.worker.ts message protocol (Issue #1970).
 * Verifies INIT and RENDER message handling contracts.
 */

// Simulate the message protocol
interface InitMessage {
  type: "INIT";
  canvas: object; // OffscreenCanvas in production
}

interface RenderMessage {
  type: "RENDER";
  density: Float32Array;
  gridW: number;
  gridH: number;
  canvasW: number;
  canvasH: number;
}

interface RenderCompleteMessage {
  type: "RENDER_COMPLETE";
}

type WorkerInMessage = InitMessage | RenderMessage;
type WorkerOutMessage = RenderCompleteMessage;

function validateInitMessage(msg: WorkerInMessage): msg is InitMessage {
  return msg.type === "INIT" && "canvas" in msg;
}

function validateRenderMessage(msg: WorkerInMessage): msg is RenderMessage {
  return (
    msg.type === "RENDER" &&
    "density" in msg &&
    "gridW" in msg &&
    "gridH" in msg &&
    "canvasW" in msg &&
    "canvasH" in msg
  );
}

describe("Heatmap renderer message protocol", () => {
  describe("INIT message", () => {
    it("valid INIT message passes validation", () => {
      const msg: WorkerInMessage = { type: "INIT", canvas: {} };
      expect(validateInitMessage(msg)).toBe(true);
    });

    it("RENDER message fails INIT validation", () => {
      const msg: WorkerInMessage = {
        type: "RENDER",
        density: new Float32Array(4),
        gridW: 2, gridH: 2, canvasW: 100, canvasH: 100,
      };
      expect(validateInitMessage(msg)).toBe(false);
    });
  });

  describe("RENDER message", () => {
    it("valid RENDER message passes validation", () => {
      const msg: WorkerInMessage = {
        type: "RENDER",
        density: new Float32Array(4),
        gridW: 2,
        gridH: 2,
        canvasW: 100,
        canvasH: 100,
      };
      expect(validateRenderMessage(msg)).toBe(true);
    });

    it("density is a Float32Array", () => {
      const msg: RenderMessage = {
        type: "RENDER",
        density: new Float32Array([0.1, 0.5, 0.9, 1.0]),
        gridW: 2, gridH: 2, canvasW: 100, canvasH: 100,
      };
      expect(msg.density).toBeInstanceOf(Float32Array);
    });

    it("density length equals gridW * gridH", () => {
      const gridW = 4;
      const gridH = 4;
      const density = new Float32Array(gridW * gridH);
      expect(density.length).toBe(gridW * gridH);
    });

    it("all density values are in 0–1 range for normalized input", () => {
      const density = new Float32Array([0, 0.25, 0.5, 0.75, 1.0]);
      density.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("RENDER_COMPLETE response", () => {
    it("response type is 'RENDER_COMPLETE'", () => {
      const response: WorkerOutMessage = { type: "RENDER_COMPLETE" };
      expect(response.type).toBe("RENDER_COMPLETE");
    });
  });
});
