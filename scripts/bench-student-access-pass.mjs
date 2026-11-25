#!/usr/bin/env node
/**
 * Reproducible Node.js benchmark for the StudentAccessPass Groth16 artifacts.
 *
 * Private witness JSON must be supplied outside the repository. This script
 * intentionally logs timings and memory only, never the witness or proof.
 */
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const required = [
  "STUDENT_ACCESS_PASS_WASM",
  "STUDENT_ACCESS_PASS_ZKEY",
  "STUDENT_ACCESS_PASS_VKEY",
  "STUDENT_ACCESS_PASS_WITNESS",
];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(2);
  }
}

const snarkjsModule = await import("snarkjs");
const snarkjs = snarkjsModule.default ?? snarkjsModule;
if (!snarkjs.groth16?.fullProve || !snarkjs.groth16?.verify) {
  throw new Error("snarkjs.groth16 fullProve/verify APIs are unavailable");
}

const witness = JSON.parse(await readFile(process.env.STUDENT_ACCESS_PASS_WITNESS, "utf8"));
const verificationKey = JSON.parse(await readFile(process.env.STUDENT_ACCESS_PASS_VKEY, "utf8"));
let peakRss = process.memoryUsage().rss;
const sample = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 5);

try {
  // One warm-up run so module/WASM startup is not mixed with later samples.
  const warm = await snarkjs.groth16.fullProve(
    witness,
    process.env.STUDENT_ACCESS_PASS_WASM,
    process.env.STUDENT_ACCESS_PASS_ZKEY,
  );
  await snarkjs.groth16.verify(verificationKey, warm.publicSignals, warm.proof);

  const proveMs = [];
  const verifyMs = [];
  const runCount = Math.max(1, Number(process.env.BENCH_RUNS ?? 30));
  for (let i = 0; i < runCount; i++) {
    const proveStart = performance.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      witness,
      process.env.STUDENT_ACCESS_PASS_WASM,
      process.env.STUDENT_ACCESS_PASS_ZKEY,
    );
    proveMs.push(performance.now() - proveStart);

    const verifyStart = performance.now();
    const valid = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
    verifyMs.push(performance.now() - verifyStart);
    if (!valid) throw new Error(`Generated proof failed verification on run ${i + 1}`);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }

  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    };
  };
  const mib = (bytes) => Number((bytes / (1024 * 1024)).toFixed(2));
  console.log(JSON.stringify({
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    runs: runCount,
    proving: stats(proveMs),
    verification: stats(verifyMs),
    baselineRssMiB: mib(process.memoryUsage().rss),
    peakRssMiB: mib(peakRss),
    note: "Warm-up excluded; witness/proof values are not logged.",
  }, null, 2));
} finally {
  clearInterval(sample);
}
