/**
 * gigabitSpeedVerifier.ts
 *
 * Zero-Knowledge Proof verifier and orchestrator for Gigabit Verified venue network claims.
 * Issue #10114.
 *
 * Constraints proved by Groth16 ZKP:
 * 1. Average download speed is strictly greater than 1000 Mbps (> 100,000 scaled).
 * 2. Packet loss is strictly less than 0.1% (< 1,000 ppm).
 * 3. Private telemetry is bound to a public nonce commitment Poseidon(venueIdHash, salt)
 *    without exposing raw speed measurements, packet-loss logs, IP metadata, or router logs.
 */

import fs from "fs";
import path from "path";
import { BN254_SCALAR_FIELD, poseidonHash } from "@/lib/zkp/poseidon";

async function loadSnarkjs(): Promise<any> {
  // Use require in Node/Jest/CommonJS environments where browser Worker is not defined
  if (typeof require !== "undefined") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("snarkjs");
    } catch {}
  }
  return await import("snarkjs");
}
import {
  releaseZkpWasmMemory,
  terminateCurveBn128,
} from "@/workers/zkpWorker";

// ── Constants & Thresholds ──────────────────────────────────────────────────

/** Required sample count for circuit inputs */
export const GIGABIT_SAMPLE_COUNT = 5;

/** Speed threshold: strictly greater than 1000 Mbps (scaled by 100 = 100,000) */
export const MIN_AVERAGE_DOWNLOAD_SPEED_MBPS = 1000;
export const SPEED_SCALE_FACTOR = 100;
export const MIN_AVERAGE_SPEED_SCALED = MIN_AVERAGE_DOWNLOAD_SPEED_MBPS * SPEED_SCALE_FACTOR; // 100000

/** Packet loss threshold: strictly less than 0.1% (scaled in parts-per-million, 0.1% = 1000 ppm) */
export const MAX_PACKET_LOSS_PERCENT = 0.1;
export const PACKET_LOSS_PPM_SCALE = 10_000; // 1% = 10,000 ppm; 0.1% = 1,000 ppm; 100% = 1,000,000 ppm
export const MAX_PACKET_LOSS_PPM = Math.round(MAX_PACKET_LOSS_PERCENT * PACKET_LOSS_PPM_SCALE); // 1000

/** Default Artifact Locations */
export const GIGABIT_WASM_PATH = "/zkp/gigabit_speed_verifier.wasm";
export const GIGABIT_ZKEY_PATH = "/zkp/gigabit_speed_verifier.zkey";
export const GIGABIT_VKEY_PATH = "/zkp/gigabit_speed_verifier_vkey.json";

export function resolveGigabitArtifactPaths(customWasm?: string, customZkey?: string): {
  wasmPath: string;
  zkeyPath: string;
} {
  const isNode = typeof window === "undefined" && typeof process !== "undefined" && typeof process.cwd === "function";
  const defaultWasm = isNode
    ? path.join(process.cwd(), "public", "zkp", "gigabit_speed_verifier.wasm")
    : GIGABIT_WASM_PATH;
  const defaultZkey = isNode
    ? path.join(process.cwd(), "public", "zkp", "gigabit_speed_verifier.zkey")
    : GIGABIT_ZKEY_PATH;

  return {
    wasmPath: customWasm || defaultWasm,
    zkeyPath: customZkey || defaultZkey,
  };
}

export const DEFAULT_GIGABIT_TIMEOUT_MS = 15_000;

// ── Types ───────────────────────────────────────────────────────────────────

export interface NetworkMeasurement {
  downloadMbps: number;
  packetLossPercent: number;
}

export interface GigabitProofInput {
  venueId: string;
  measurements: NetworkMeasurement[];
  salt?: string | bigint;
}

export interface PreparedGigabitCircuitInputs {
  minAverageSpeedScaled: string;
  maxPacketLossPpm: string;
  venueNonceCommitment: string;
  downloadSpeedsScaled: string[];
  packetLossPpm: string[];
  venueIdHash: string;
  measurementSalt: string;
}

export interface Groth16ProofPayload {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol?: string;
  curve?: string;
}

export interface GigabitVerificationResult {
  verified: boolean;
  claim: "GIGABIT_VERIFIED" | "REJECTED";
  venueId: string;
  publicSignals: string[];
  commitment: string;
  proof?: Groth16ProofPayload;
  error?: string;
  durationMs?: number;
}

export interface GigabitVerifierOptions {
  wasmPath?: string;
  zkeyPath?: string;
  vkeyPath?: string;
  timeoutMs?: number;
  workerFactory?: () => WorkerLike;
}

export interface WorkerLike {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent | unknown) => void) | null;
}

// ── Numeric & Validation Utilities ──────────────────────────────────────────

/**
 * Derives a deterministic field scalar from a venue identifier.
 */
export function hashVenueIdToField(venueId: string): bigint {
  if (!venueId || typeof venueId !== "string" || venueId.trim().length === 0) {
    throw new Error("Invalid venueId: must be a non-empty string");
  }

  let hash = 2166136261n;
  for (let i = 0; i < venueId.length; i++) {
    hash ^= BigInt(venueId.charCodeAt(i));
    hash = (hash * 16777619n) % BN254_SCALAR_FIELD;
  }
  return hash;
}

/**
 * Validates raw network measurements.
 * Rejects negative, NaN, infinite, or malformed numbers.
 */
export function validateMeasurements(measurements: NetworkMeasurement[]): void {
  if (!Array.isArray(measurements) || measurements.length !== GIGABIT_SAMPLE_COUNT) {
    throw new Error(
      `Invalid measurement sample count: expected exactly ${GIGABIT_SAMPLE_COUNT} samples, got ${measurements?.length ?? 0}`,
    );
  }

  for (let i = 0; i < measurements.length; i++) {
    const m = measurements[i];
    if (!m || typeof m !== "object") {
      throw new Error(`Measurement at index ${i} is not a valid object`);
    }

    if (
      typeof m.downloadMbps !== "number" ||
      !Number.isFinite(m.downloadMbps) ||
      Number.isNaN(m.downloadMbps) ||
      m.downloadMbps < 0
    ) {
      throw new Error(
        `Invalid downloadMbps at index ${i}: must be a non-negative finite number (got ${m.downloadMbps})`,
      );
    }

    if (
      typeof m.packetLossPercent !== "number" ||
      !Number.isFinite(m.packetLossPercent) ||
      Number.isNaN(m.packetLossPercent) ||
      m.packetLossPercent < 0 ||
      m.packetLossPercent > 100
    ) {
      throw new Error(
        `Invalid packetLossPercent at index ${i}: must be a finite number between 0 and 100 (got ${m.packetLossPercent})`,
      );
    }
  }
}

/**
 * Prepares and formats private witness and public signals for the Groth16 circuit.
 */
export function prepareGigabitCircuitInputs(input: GigabitProofInput): {
  circuitInputs: PreparedGigabitCircuitInputs;
  expectedCommitment: string;
} {
  validateMeasurements(input.measurements);

  const venueIdHash = hashVenueIdToField(input.venueId);

  let saltBigInt: bigint;
  if (input.salt !== undefined) {
    if (typeof input.salt === "bigint") {
      saltBigInt = (input.salt % BN254_SCALAR_FIELD + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
    } else {
      saltBigInt = hashVenueIdToField(String(input.salt));
    }
  } else {
    // Deterministic default salt for repeatability if unspecified
    saltBigInt = 424242n;
  }

  const commitment = poseidonHash([venueIdHash, saltBigInt]).toString();

  const downloadSpeedsScaled = input.measurements.map((m) =>
    Math.round(m.downloadMbps * SPEED_SCALE_FACTOR).toString(),
  );

  const packetLossPpm = input.measurements.map((m) =>
    Math.round(m.packetLossPercent * PACKET_LOSS_PPM_SCALE).toString(),
  );

  const circuitInputs: PreparedGigabitCircuitInputs = {
    minAverageSpeedScaled: MIN_AVERAGE_SPEED_SCALED.toString(),
    maxPacketLossPpm: MAX_PACKET_LOSS_PPM.toString(),
    venueNonceCommitment: commitment,
    downloadSpeedsScaled,
    packetLossPpm,
    venueIdHash: venueIdHash.toString(),
    measurementSalt: saltBigInt.toString(),
  };

  return { circuitInputs, expectedCommitment: commitment };
}

/**
 * Checks whether client-side measurements satisfy thresholds prior to proving.
 */
export function evaluateMeasurementsPrecheck(measurements: NetworkMeasurement[]): {
  valid: boolean;
  averageSpeedMbps: number;
  averagePacketLossPercent: number;
  reason?: string;
} {
  validateMeasurements(measurements);

  const totalSpeed = measurements.reduce((acc, m) => acc + m.downloadMbps, 0);
  const avgSpeed = totalSpeed / measurements.length;

  const totalLoss = measurements.reduce((acc, m) => acc + m.packetLossPercent, 0);
  const avgLoss = totalLoss / measurements.length;

  if (avgSpeed <= MIN_AVERAGE_DOWNLOAD_SPEED_MBPS) {
    return {
      valid: false,
      averageSpeedMbps: avgSpeed,
      averagePacketLossPercent: avgLoss,
      reason: `Average download speed (${avgSpeed.toFixed(2)} Mbps) is not strictly greater than ${MIN_AVERAGE_DOWNLOAD_SPEED_MBPS} Mbps`,
    };
  }

  if (avgLoss >= MAX_PACKET_LOSS_PERCENT) {
    return {
      valid: false,
      averageSpeedMbps: avgSpeed,
      averagePacketLossPercent: avgLoss,
      reason: `Average packet loss (${avgLoss.toFixed(4)}%) is not strictly less than ${MAX_PACKET_LOSS_PERCENT}%`,
    };
  }

  return {
    valid: true,
    averageSpeedMbps: avgSpeed,
    averagePacketLossPercent: avgLoss,
  };
}

// ── Verification Key Loader ─────────────────────────────────────────────────

let cachedVKey: Record<string, unknown> | null = null;

export async function loadGigabitVerificationKey(customPath?: string): Promise<Record<string, unknown>> {
  if (cachedVKey && !customPath) {
    return cachedVKey;
  }

  const vkeyPath = customPath || path.join(process.cwd(), "public", "zkp", "gigabit_speed_verifier_vkey.json");

  try {
    const content = fs.readFileSync(vkeyPath, "utf8");
    const parsed = JSON.parse(content);
    if (!customPath) cachedVKey = parsed;
    return parsed;
  } catch (err) {
    throw new Error(
      `Failed to load Gigabit verification key from ${vkeyPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Direct Groth16 Prover & Verifier (Node / Background Prover) ─────────────

/**
 * Generates a Groth16 zero-knowledge proof for Gigabit verification.
 */
export async function generateGigabitProof(
  input: GigabitProofInput,
  options: GigabitVerifierOptions = {},
): Promise<{
  proof: Groth16ProofPayload;
  publicSignals: string[];
  durationMs: number;
}> {
  const precheck = evaluateMeasurementsPrecheck(input.measurements);
  if (!precheck.valid) {
    throw new Error(`Pre-circuit constraint check failed: ${precheck.reason}`);
  }

  const { circuitInputs } = prepareGigabitCircuitInputs(input);

  const { wasmPath, zkeyPath } = resolveGigabitArtifactPaths(options.wasmPath, options.zkeyPath);

  const startTime = Date.now();
  try {
    const snarkjs = await loadSnarkjs();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs as unknown as Record<string, unknown>,
      wasmPath,
      zkeyPath,
    );

    return {
      proof: proof as Groth16ProofPayload,
      publicSignals,
      durationMs: Date.now() - startTime,
    };
  } finally {
    await terminateCurveBn128();
  }
}

/**
 * Cryptographically verifies a Groth16 proof against expected public signals.
 */
export async function verifyGigabitProof(
  proof: Groth16ProofPayload,
  publicSignals: string[],
  options: {
    vkey?: Record<string, unknown>;
    vkeyPath?: string;
    expectedCommitment?: string;
  } = {},
): Promise<boolean> {
  if (!proof || typeof proof !== "object" || !Array.isArray(publicSignals)) {
    return false;
  }

  // Public signals structure: [minAverageSpeedScaled, maxPacketLossPpm, venueNonceCommitment]
  if (publicSignals.length !== 3) {
    return false;
  }

  // Verify thresholds match the exact circuit constants
  if (
    publicSignals[0] !== MIN_AVERAGE_SPEED_SCALED.toString() ||
    publicSignals[1] !== MAX_PACKET_LOSS_PPM.toString()
  ) {
    return false;
  }

  // If expected commitment is supplied, verify it matches public signal
  if (options.expectedCommitment && publicSignals[2] !== options.expectedCommitment) {
    return false;
  }

  try {
    const snarkjs = await loadSnarkjs();
    const vKey = options.vkey || (await loadGigabitVerificationKey(options.vkeyPath));
    const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    return isValid === true;
  } catch {
    return false;
  } finally {
    await terminateCurveBn128();
  }
}

// ── GigabitSpeedVerifier Orchestrator ───────────────────────────────────────

export class GigabitSpeedVerifier {
  private options: GigabitVerifierOptions;

  constructor(options: GigabitVerifierOptions = {}) {
    this.options = options;
  }

  /**
   * Executes full verification flow:
   * 1. Validates inputs & arithmetic thresholds.
   * 2. Prepares anonymous signals & commitment.
   * 3. Generates Groth16 proof.
   * 4. Cryptographically verifies proof.
   * 5. Returns typed verification result without leaking raw measurements.
   */
  public async verifyVenueNetworkClaim(
    input: GigabitProofInput,
  ): Promise<GigabitVerificationResult> {
    const startTime = Date.now();

    try {
      // 1. Input & threshold validation
      const precheck = evaluateMeasurementsPrecheck(input.measurements);
      if (!precheck.valid) {
        return {
          verified: false,
          claim: "REJECTED",
          venueId: input.venueId,
          publicSignals: [],
          commitment: "",
          error: precheck.reason,
          durationMs: Date.now() - startTime,
        };
      }

      // 2. Prepare circuit inputs
      const { expectedCommitment } = prepareGigabitCircuitInputs(input);

      // 3. Generate Groth16 proof
      const { proof, publicSignals } = await generateGigabitProof(input, this.options);

      // 4. Verify Groth16 proof against public signals and commitment
      const isValid = await verifyGigabitProof(proof, publicSignals, {
        vkeyPath: this.options.vkeyPath,
        expectedCommitment,
      });

      if (!isValid) {
        return {
          verified: false,
          claim: "REJECTED",
          venueId: input.venueId,
          publicSignals,
          commitment: expectedCommitment,
          error: "Cryptographic proof verification failed.",
          durationMs: Date.now() - startTime,
        };
      }

      return {
        verified: true,
        claim: "GIGABIT_VERIFIED",
        venueId: input.venueId,
        publicSignals,
        commitment: expectedCommitment,
        proof,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        verified: false,
        claim: "REJECTED",
        venueId: input.venueId,
        publicSignals: [],
        commitment: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    } finally {
      releaseZkpWasmMemory();
      await terminateCurveBn128();
    }
  }

  public async terminate(): Promise<void> {
    releaseZkpWasmMemory();
    await terminateCurveBn128();
  }
}
