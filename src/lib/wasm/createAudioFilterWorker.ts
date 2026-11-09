/**
 * Browser factory for the audio filter worker (#3361). Kept in its own module
 * because `import.meta.url` worker URLs are bundler-specific and not loadable
 * under Jest; tests pass their own `createWorker` to the pool instead.
 */

import type { AudioFilterWorkerLike } from "./audioFilterWorkerPool";

export function createAudioFilterWorker(): AudioFilterWorkerLike {
  return new Worker(new URL("../../workers/audioFilter.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as AudioFilterWorkerLike;
}
