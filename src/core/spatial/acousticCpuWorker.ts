import { simulateAcousticsCpu } from "./acousticCpu";
import type { AcousticOptions, AcousticScene } from "./acousticTypes";

interface WorkerScope {
  onmessage:
    | ((e: {
        data: { scene: AcousticScene; options: AcousticOptions };
      }) => void)
    | null;
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e) => {
  try {
    const { histogram, grid } = simulateAcousticsCpu(
      e.data.scene,
      e.data.options,
    );
    ctx.postMessage({ ok: true, histogram, grid }, [
      histogram.buffer as ArrayBuffer,
      grid.buffer as ArrayBuffer,
    ]);
  } catch (err) {
    ctx.postMessage({ ok: false, error: String(err) });
  }
};

export {};
