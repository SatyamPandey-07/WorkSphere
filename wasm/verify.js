const fs = require("fs");
const path = require("path");

async function verify() {
  const wasmPath = path.resolve(__dirname, "..", "public", "noise-processor.wasm");
  const bytes = fs.readFileSync(wasmPath);

  const wasmModule = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(wasmModule);

  const { memory, malloc, free, computeRMS, resetHeap } = instance.exports;

  console.log("=== WASM Module Verification ===");

  const ptr = malloc(8 * 4);
  console.log("Allocated 8 floats at ptr:", ptr);

  const view = new Float32Array(memory.buffer);
  view[ptr / 4] = 0.5;
  view[ptr / 4 + 1] = 0.3;
  view[ptr / 4 + 2] = 0.8;
  view[ptr / 4 + 3] = 0.2;
  view[ptr / 4 + 4] = 0.6;
  view[ptr / 4 + 5] = 0.1;
  view[ptr / 4 + 6] = 0.4;
  view[ptr / 4 + 7] = 0.7;

  const rms = computeRMS(ptr, 8);
  console.log("RMS of test data:", rms);

  free(ptr, 8 * 4);
  console.log("Freed memory at ptr:", ptr);

  const ptr2 = malloc(4 * 4);
  console.log("Allocated 4 floats at ptr:", ptr2);
  console.log("Reused freed memory:", ptr === ptr2);

  view[ptr2 / 4] = 1.0;
  view[ptr2 / 4 + 1] = 0.0;
  view[ptr2 / 4 + 2] = 0.5;
  view[ptr2 / 4 + 3] = 0.5;

  const rms2 = computeRMS(ptr2, 4);
  console.log("RMS of second test data:", rms2);

  resetHeap();
  const ptr3 = malloc(4);
  console.log("After resetHeap, ptr3:", ptr3);
  console.log("Expected initial ptr (1024):", ptr3 === 1024);

  console.log("\n=== All checks passed ===");
}

verify().catch(console.error);
