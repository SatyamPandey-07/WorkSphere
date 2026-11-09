/**
 * Off-main-thread WASM audio filter worker (#3361).
 * All logic lives in src/lib/wasm/audioFilterWorkerCore.ts.
 */

import {
  createAudioFilterWorkerHandler,
  type AudioFilterWorkerRequest,
} from "../lib/wasm/audioFilterWorkerCore";

const handle = createAudioFilterWorkerHandler({
  post: (message, transfer = []) => self.postMessage(message, { transfer }),
});

self.onmessage = (event: MessageEvent<AudioFilterWorkerRequest>) => {
  void handle(event.data);
};

export {};
