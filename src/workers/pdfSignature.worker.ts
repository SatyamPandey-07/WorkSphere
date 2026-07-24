import {
  extractSignatures,
  getSignedBytes,
} from "@/lib/pdf-verify/pdfSignatureExtractor";
import { fetchCaRootsPem } from "@/lib/pdf-verify/caRoots";

let pdfVerifyModule: any = null;

async function initWasm() {
  if (pdfVerifyModule) return;
  const wasmUrl = "/pdf-verify.js";
  const factoryModule = await import(/* @vite-ignore */ wasmUrl);
  const factory = factoryModule.default || factoryModule;

  pdfVerifyModule = await factory({
    locateFile: (path: string) => {
      if (path.endsWith(".wasm")) {
        return "/pdf-verify.wasm";
      }
      return path;
    },
  });
}

let fileBuffer: Uint8Array = new Uint8Array(0);

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === "chunk") {
    const { chunk } = payload;
    const newBuffer = new Uint8Array(fileBuffer.length + chunk.length);
    newBuffer.set(fileBuffer);
    newBuffer.set(new Uint8Array(chunk), fileBuffer.length);
    fileBuffer = newBuffer;
  } else if (type === "verify") {
    try {
      self.postMessage({ type: "progress", progress: 50 });

      const signatures = extractSignatures(fileBuffer);
      if (signatures.length === 0) {
        self.postMessage({ type: "result", signatures: [] });
        return;
      }

      await initWasm();

      self.postMessage({ type: "progress", progress: 75 });

      const caRoots = await fetchCaRootsPem();
      const results = [];

      for (const sig of signatures) {
        const signedBytes = getSignedBytes(fileBuffer, sig.byteRange);

        const verifyResult = pdfVerifyModule.verifyPdfSignature(
          signedBytes,
          sig.contents,
          sig.byteRange.offset1,
          sig.byteRange.length1,
          sig.byteRange.offset2,
          sig.byteRange.length2,
          caRoots || "",
        );

        results.push({
          signature: sig,
          result: {
            valid: verifyResult.valid,
            signerName: verifyResult.signerName || "",
            signingTime: verifyResult.signingTime || "",
            algorithm: verifyResult.algorithm || "",
            error: verifyResult.error || "",
          },
        });
      }

      self.postMessage({ type: "progress", progress: 100 });
      self.postMessage({ type: "result", results });
    } catch (error) {
      self.postMessage({
        type: "error",
        error: error instanceof Error ? error.message : "Verification failed",
      });
    } finally {
      // Cleanup for next file
      fileBuffer = new Uint8Array(0);
    }
  }
};
