import type { WorkerRequest, WorkerResponse } from "@/types/pdfSignature";

let pdfVerifyModule: {
  verifyPdfSignature: (
    pdfBytes: Uint8Array,
    cmsBlob: Uint8Array,
    offset1: number,
    length1: number,
    offset2: number,
    length2: number,
    caRootsPem: string,
  ) => {
    valid: boolean;
    signerName: string;
    signingTime: string;
    algorithm: string;
    error: string;
  };
} | null = null;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { action, id, payload } = e.data;

  if (action === "init") {
    try {
      if (!payload?.wasmUrl) {
        throw new Error("wasmUrl is required for init");
      }

      const factoryModule = await import(/* @vite-ignore */ payload.wasmUrl);
      const factory = factoryModule.default || factoryModule;

      pdfVerifyModule = await factory({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) {
            return payload.wasmUrl;
          }
          return path;
        },
      });

      const reply: WorkerResponse = { action: "ready", id };
      self.postMessage(reply);
    } catch (err) {
      const reply: WorkerResponse = {
        action: "error",
        id,
        error: `WASM init failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      self.postMessage(reply);
    }
    return;
  }

  if (action === "verify") {
    if (!pdfVerifyModule) {
      const reply: WorkerResponse = {
        action: "error",
        id,
        error: "WASM module not initialized. Send init action first.",
      };
      self.postMessage(reply);
      return;
    }

    try {
      const { pdfBytes, cmsBlob, byteRange, caRoots } = payload || {};
      if (!pdfBytes || !cmsBlob || !byteRange) {
        throw new Error("pdfBytes, cmsBlob, and byteRange are required");
      }

      const result = pdfVerifyModule.verifyPdfSignature(
        pdfBytes,
        cmsBlob,
        byteRange.offset1,
        byteRange.length1,
        byteRange.offset2,
        byteRange.length2,
        caRoots || "",
      );

      const reply: WorkerResponse = {
        action: "result",
        id,
        result: {
          valid: result.valid,
          signerName: result.signerName || "",
          signingTime: result.signingTime || "",
          algorithm: result.algorithm || "",
          error: result.error || "",
        },
      };
      self.postMessage(reply);
    } catch (err) {
      const reply: WorkerResponse = {
        action: "error",
        id,
        error: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      self.postMessage(reply);
    }
    return;
  }
};
