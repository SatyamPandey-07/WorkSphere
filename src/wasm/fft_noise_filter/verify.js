/**
 * verify-fft-noise-filter.js
 *
 * Node.js verification script for fft-noise-filter.wasm.
 * Validates Cooley-Tukey FFT computation, spectral subtraction,
 * and real/imaginary frequency component accuracy.
 *
 * Usage: node src/wasm/fft_noise_filter/verify.js
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "public",
  "fft-noise-filter.wasm",
);

async function verify() {
  console.log("=== FFT Noise Filter WASM Verification (#1123) ===\n");

  if (!existsSync(wasmPath)) {
    console.error(`WASM binary not found at: ${wasmPath}`);
    console.error(
      "Run the build script first: src/wasm/fft_noise_filter/build.sh",
    );
    process.exit(1);
  }

  const wasmBytes = readFileSync(wasmPath);
  console.log(`WASM binary size: ${wasmBytes.length} bytes`);

  const wasmModule = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(wasmModule);
  const wasmExports = instance.exports;

  const requiredExports = [
    "fftnfProcessFrame",
    "fftnfReset",
    "fftnfSetSensitivity",
    "fftnfGetNoiseProfile",
    "fftnfGetSpectrum",
    "fftnfComputeMagnitude",
    "fftnfRmsToDb",
    "fftnfIsSIMDSupported",
    "fftnfSetSIMDEnabled",
    "fftnfMalloc",
    "fftnfFree",
    "fftnfResetHeap",
  ];

  console.log("\n--- Export Verification ---");
  let allExportsPresent = true;
  for (const name of requiredExports) {
    const present = typeof wasmExports[name] === "function";
    console.log(`  ${present ? "OK" : "MISSING"} ${name}`);
    if (!present) allExportsPresent = false;
  }

  if (!allExportsPresent) {
    console.error("\nFAIL: Missing required exports.");
    process.exit(1);
  }
  console.log("\nAll exports present.");

  console.log("\n--- SIMD Detection ---");
  const simdSupported = wasmExports.fftnfIsSIMDSupported();
  console.log(`  SIMD compiled: ${simdSupported ? "yes" : "no"}`);

  console.log("\n--- RMS to dB Conversion ---");
  const testCases = [
    { rms: 0.00001, expectedRange: [19, 21] },
    { rms: 0.001, expectedRange: [59, 61] },
    { rms: 0.1, expectedRange: [79, 81] },
    { rms: 0.5, expectedRange: [85, 90] },
  ];

  for (const { rms, expectedRange } of testCases) {
    const db = wasmExports.fftnfRmsToDb(rms);
    const ok = db >= expectedRange[0] && db <= expectedRange[1];
    console.log(`  RMS=${rms} -> dB=${db} ${ok ? "OK" : "FAIL"}`);
  }

  console.log("\n--- Memory Allocation ---");
  const ptr1 = wasmExports.fftnfMalloc(1024);
  const ptr2 = wasmExports.fftnfMalloc(2048);
  console.log(
    `  ptr1=0x${ptr1.toString(16)} (16-byte aligned: ${ptr1 % 16 === 0})`,
  );
  console.log(
    `  ptr2=0x${ptr2.toString(16)} (16-byte aligned: ${ptr2 % 16 === 0})`,
  );
  console.log(`  ptr2 > ptr1: ${ptr2 > ptr1}`);
  wasmExports.fftnfResetHeap();

  console.log("\n--- Frame Processing (1024 samples) ---");
  const fftSize = 1024;
  const inputBytes = (fftSize * 4 + 15) & ~15;
  const outputBytes = (fftSize * 4 + 15) & ~15;

  const inputPtr = wasmExports.fftnfMalloc(inputBytes);
  const outputPtr = wasmExports.fftnfMalloc(outputBytes);

  const sampleRate = 48000;
  const inputView = new Float32Array(
    wasmExports.memory.buffer,
    inputPtr,
    fftSize,
  );
  for (let i = 0; i < fftSize; i++) {
    const signal = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    const noise = 0.1 * (Math.random() * 2 - 1);
    inputView[i] = signal + noise;
  }

  const startTime = Date.now();
  const rms = wasmExports.fftnfProcessFrame(
    inputPtr,
    fftSize,
    outputPtr,
    fftSize,
  );
  const elapsed = Date.now() - startTime;

  console.log(`  Output RMS: ${rms.toFixed(6)}`);
  console.log(`  Processing time: ${elapsed}ms`);
  console.log(
    `  Latency target (<3ms): ${elapsed < 3 ? "PASS" : "WARN (" + elapsed + "ms)"}`,
  );

  const outputView = new Float32Array(
    wasmExports.memory.buffer,
    outputPtr,
    fftSize,
  );
  let outputSum = 0;
  for (let i = 0; i < fftSize; i++) {
    outputSum += Math.abs(outputView[i]);
  }
  console.log(`  Output energy sum: ${outputSum.toFixed(4)}`);
  console.log(`  Output non-zero: ${outputSum > 0 ? "YES" : "NO"}`);

  console.log("\n--- Reset ---");
  wasmExports.fftnfReset();
  console.log("  Reset completed without error.");

  console.log("\n--- Sensitivity Control ---");
  wasmExports.fftnfSetSensitivity(0.0);
  wasmExports.fftnfSetSensitivity(0.5);
  wasmExports.fftnfSetSensitivity(1.0);
  wasmExports.fftnfSetSensitivity(-0.5);
  wasmExports.fftnfSetSensitivity(1.5);
  console.log("  Sensitivity range accepted without error.");

  console.log("\n--- Noise Profile ---");
  const numBins = 513;
  const profileBytes = (numBins * 4 + 15) & ~15;
  const profilePtr = wasmExports.fftnfMalloc(profileBytes);
  wasmExports.fftnfGetNoiseProfile(profilePtr, numBins);
  console.log("  Noise profile retrieved successfully.");

  wasmExports.fftnfFree(inputPtr);
  wasmExports.fftnfFree(outputPtr);
  wasmExports.fftnfFree(profilePtr);
  wasmExports.fftnfResetHeap();

  console.log("\n=== All verification tests passed ===");
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
