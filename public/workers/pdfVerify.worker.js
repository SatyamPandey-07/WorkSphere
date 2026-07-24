let wasmModule = null;

self.importScripts("/pdf-verify.js"); // Emscripten generated JS

Module.onRuntimeInitialized = () => {
  wasmModule = Module;
};

self.addEventListener("message", async (e) => {
  const { action, id, payload } = e.data;

  if (action === "init") {
    // Wait for the wasm module to be ready
    const checkReady = setInterval(() => {
      if (wasmModule) {
        clearInterval(checkReady);
        self.postMessage({ id, action: "ready" });
      }
    }, 100);
  } else if (action === "verify") {
    try {
      const { pdfBytes, signatureInfo } = payload;

      // Allocate memory for the arrays
      const pdfPtr = wasmModule._malloc(pdfBytes.length);
      const sigPtr = wasmModule._malloc(signatureInfo.contents.length);

      // Copy data to WASM heap
      wasmModule.HEAPU8.set(pdfBytes, pdfPtr);
      wasmModule.HEAPU8.set(signatureInfo.contents, sigPtr);

      // Call C++ verify function
      const resultPtr = wasmModule._verifySignature(
        pdfPtr,
        pdfBytes.length,
        sigPtr,
        signatureInfo.contents.length,
      );

      // Read result from string pointer (assuming it returns JSON string)
      const resultStr = wasmModule.UTF8ToString(resultPtr);
      const result = JSON.parse(resultStr);

      // Free memory
      wasmModule._free(pdfPtr);
      wasmModule._free(sigPtr);
      wasmModule._free(resultPtr);

      self.postMessage({ id, action: "result", result });
    } catch (error) {
      self.postMessage({ id, action: "error", error: error.message });
    }
  }
});
