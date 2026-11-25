/**
 * @jest-environment node
 *
 * gigabitSpeedVerifier.test.ts
 *
 * Comprehensive unit and integration test suite for Gigabit Network ZKP Verification (#10114).
 *
 * Covers:
 * 1. Valid measurements satisfying both thresholds (>1000 Mbps average, <0.1% packet loss).
 * 2. Download speed equal to or below 1000 Mbps.
 * 3. Packet loss equal to or above 0.1%.
 * 4. Invalid, missing, negative, NaN, or malformed measurements.
 * 5. Valid proof verification with Groth16.
 * 6. Invalid or tampered proof rejection.
 * 7. Incorrect or mismatched public signals / thresholds rejection.
 * 8. Worker success, progress, and error message handling.
 * 9. Ensuring private telemetry is not returned or exposed in public responses.
 * 10. Benchmarking proof generation performance.
 */

import path from "path";
import {
  GigabitSpeedVerifier,
  generateGigabitProof,
  verifyGigabitProof,
  evaluateMeasurementsPrecheck,
  validateMeasurements,
  prepareGigabitCircuitInputs,
  hashVenueIdToField,
  GIGABIT_SAMPLE_COUNT,
  type NetworkMeasurement,
  type GigabitProofInput,
} from "@/features/zkp/gigabitSpeedVerifier";
import {
  handleZkpWorkerMessage,
  terminateCurveBn128,
  type ZkpWorkerOutgoingMessage,
  type ZkpProofRequest,
} from "@/workers/zkpWorker";

const WASM_PATH = path.join(process.cwd(), "public", "zkp", "gigabit_speed_verifier.wasm");
const ZKEY_PATH = path.join(process.cwd(), "public", "zkp", "gigabit_speed_verifier.zkey");
const VKEY_PATH = path.join(process.cwd(), "public", "zkp", "gigabit_speed_verifier_vkey.json");

describe("Gigabit Speed Verifier (#10114)", () => {
  afterEach(async () => {
    await terminateCurveBn128();
  });

  const validMeasurements: NetworkMeasurement[] = [
    { downloadMbps: 1050.2, packetLossPercent: 0.02 },
    { downloadMbps: 1100.5, packetLossPercent: 0.01 },
    { downloadMbps: 1020.0, packetLossPercent: 0.05 },
    { downloadMbps: 1005.1, packetLossPercent: 0.00 },
    { downloadMbps: 1200.8, packetLossPercent: 0.08 },
  ];

  describe("Measurement Validation and Pre-circuit Arithmetic", () => {
    it("accepts valid measurements satisfying both thresholds (>1000 Mbps, <0.1% loss)", () => {
      const result = evaluateMeasurementsPrecheck(validMeasurements);
      expect(result.valid).toBe(true);
      expect(result.averageSpeedMbps).toBeGreaterThan(1000);
      expect(result.averagePacketLossPercent).toBeLessThan(0.1);
    });

    it("rejects download speed strictly equal to 1000 Mbps", () => {
      const equal1000Measurements: NetworkMeasurement[] = Array(GIGABIT_SAMPLE_COUNT).fill({
        downloadMbps: 1000.0,
        packetLossPercent: 0.01,
      });

      const result = evaluateMeasurementsPrecheck(equal1000Measurements);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("strictly greater than 1000 Mbps");
    });

    it("rejects download speed below 1000 Mbps", () => {
      const subGigabitMeasurements: NetworkMeasurement[] = [
        { downloadMbps: 950.0, packetLossPercent: 0.01 },
        { downloadMbps: 980.0, packetLossPercent: 0.02 },
        { downloadMbps: 990.0, packetLossPercent: 0.03 },
        { downloadMbps: 1000.0, packetLossPercent: 0.01 },
        { downloadMbps: 1010.0, packetLossPercent: 0.02 },
      ]; // average = 986 Mbps

      const result = evaluateMeasurementsPrecheck(subGigabitMeasurements);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("strictly greater than 1000 Mbps");
    });

    it("rejects packet loss strictly equal to 0.1%", () => {
      const equalLossMeasurements: NetworkMeasurement[] = Array(GIGABIT_SAMPLE_COUNT).fill({
        downloadMbps: 1200.0,
        packetLossPercent: 0.1,
      });

      const result = evaluateMeasurementsPrecheck(equalLossMeasurements);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("strictly less than 0.1%");
    });

    it("rejects packet loss strictly above 0.1%", () => {
      const highLossMeasurements: NetworkMeasurement[] = [
        { downloadMbps: 1200.0, packetLossPercent: 0.15 },
        { downloadMbps: 1300.0, packetLossPercent: 0.12 },
        { downloadMbps: 1100.0, packetLossPercent: 0.09 },
        { downloadMbps: 1400.0, packetLossPercent: 0.10 },
        { downloadMbps: 1250.0, packetLossPercent: 0.11 },
      ];

      const result = evaluateMeasurementsPrecheck(highLossMeasurements);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("strictly less than 0.1%");
    });

    it("rejects invalid, negative, NaN, or infinite measurements", () => {
      expect(() => {
        validateMeasurements([
          { downloadMbps: -100, packetLossPercent: 0.01 },
          ...validMeasurements.slice(1),
        ]);
      }).toThrow(/Invalid downloadMbps/);

      expect(() => {
        validateMeasurements([
          { downloadMbps: NaN, packetLossPercent: 0.01 },
          ...validMeasurements.slice(1),
        ]);
      }).toThrow(/Invalid downloadMbps/);

      expect(() => {
        validateMeasurements([
          { downloadMbps: Infinity, packetLossPercent: 0.01 },
          ...validMeasurements.slice(1),
        ]);
      }).toThrow(/Invalid downloadMbps/);

      expect(() => {
        validateMeasurements([
          { downloadMbps: 1200, packetLossPercent: -0.05 },
          ...validMeasurements.slice(1),
        ]);
      }).toThrow(/Invalid packetLossPercent/);

      expect(() => {
        validateMeasurements([
          { downloadMbps: 1200, packetLossPercent: 105 },
          ...validMeasurements.slice(1),
        ]);
      }).toThrow(/Invalid packetLossPercent/);
    });

    it("rejects incorrect sample count (too few or too many samples)", () => {
      expect(() => validateMeasurements(validMeasurements.slice(0, 3))).toThrow(
        /Invalid measurement sample count: expected exactly 5 samples/,
      );

      expect(() =>
        validateMeasurements([...validMeasurements, { downloadMbps: 1100, packetLossPercent: 0.01 }]),
      ).toThrow(/Invalid measurement sample count: expected exactly 5 samples/);
    });

    it("rejects empty or invalid venueId", () => {
      expect(() => hashVenueIdToField("")).toThrow(/Invalid venueId/);
      expect(() => hashVenueIdToField("   ")).toThrow(/Invalid venueId/);
    });
  });

  describe("Witness & Signal Preparation Confidentiality", () => {
    it("formats integer-scaled inputs and generates anonymized commitment", () => {
      const input: GigabitProofInput = {
        venueId: "venue-fiber-hub-77",
        measurements: validMeasurements,
        salt: 999999n,
      };

      const { circuitInputs, expectedCommitment } = prepareGigabitCircuitInputs(input);

      expect(circuitInputs.minAverageSpeedScaled).toBe("100000");
      expect(circuitInputs.maxPacketLossPpm).toBe("1000");
      expect(circuitInputs.venueNonceCommitment).toBe(expectedCommitment);

      // Verify integer scaling (no floating point decimals inside circuit input strings)
      circuitInputs.downloadSpeedsScaled.forEach((speed) => {
        expect(speed).toMatch(/^\d+$/);
      });
      circuitInputs.packetLossPpm.forEach((loss) => {
        expect(loss).toMatch(/^\d+$/);
      });
    });
  });

  describe("Cryptographic Groth16 Proof Synthesis & Verification", () => {
    it("generates a legitimate Groth16 proof and verifies it successfully", async () => {
      const input: GigabitProofInput = {
        venueId: "venue-fiber-superhub-1",
        measurements: validMeasurements,
        salt: "salt-secret-alpha",
      };

      const proverOptions = { wasmPath: WASM_PATH, zkeyPath: ZKEY_PATH };
      const { proof, publicSignals, durationMs } = await generateGigabitProof(input, proverOptions);

      expect(proof).toBeDefined();
      expect(proof.pi_a).toHaveLength(3);
      expect(proof.pi_b).toHaveLength(3);
      expect(proof.pi_c).toHaveLength(3);

      expect(publicSignals).toHaveLength(3);
      expect(publicSignals[0]).toBe("100000"); // minAverageSpeedScaled
      expect(publicSignals[1]).toBe("1000");   // maxPacketLossPpm

      // Cryptographic verification against the compiled verification key
      const isValid = await verifyGigabitProof(proof, publicSignals, { vkeyPath: VKEY_PATH });
      expect(isValid).toBe(true);

      // Verify execution completed
      expect(durationMs).toBeGreaterThan(0);
    }, 20_000);

    it("rejects proof with tampered public signals (e.g. altered speed threshold)", async () => {
      const input: GigabitProofInput = {
        venueId: "venue-fiber-hub-2",
        measurements: validMeasurements,
      };

      const { proof, publicSignals } = await generateGigabitProof(input, {
        wasmPath: WASM_PATH,
        zkeyPath: ZKEY_PATH,
      });

      // Tamper with public threshold signal (e.g., attempt to change threshold from 100000 to 50000)
      const tamperedSignals = ["50000", publicSignals[1], publicSignals[2]];
      const isValid = await verifyGigabitProof(proof, tamperedSignals, { vkeyPath: VKEY_PATH });

      expect(isValid).toBe(false);
    }, 20_000);

    it("rejects proof with tampered proof elements (corrupted pi_a curve points)", async () => {
      const input: GigabitProofInput = {
        venueId: "venue-fiber-hub-3",
        measurements: validMeasurements,
      };

      const { proof, publicSignals } = await generateGigabitProof(input, {
        wasmPath: WASM_PATH,
        zkeyPath: ZKEY_PATH,
      });

      // Tamper with pi_a proof element
      const tamperedProof = {
        ...proof,
        pi_a: ["1234567890123456789", proof.pi_a[1], proof.pi_a[2]],
      };

      const isValid = await verifyGigabitProof(tamperedProof, publicSignals, { vkeyPath: VKEY_PATH });
      expect(isValid).toBe(false);
    }, 20_000);

    it("rejects proof when expected nonce commitment does not match", async () => {
      const input: GigabitProofInput = {
        venueId: "venue-fiber-hub-4",
        measurements: validMeasurements,
      };

      const { proof, publicSignals } = await generateGigabitProof(input, {
        wasmPath: WASM_PATH,
        zkeyPath: ZKEY_PATH,
      });

      const wrongCommitment = "99999999999999999999999";
      const isValid = await verifyGigabitProof(proof, publicSignals, {
        vkeyPath: VKEY_PATH,
        expectedCommitment: wrongCommitment,
      });

      expect(isValid).toBe(false);
    }, 20_000);
  });

  describe("GigabitSpeedVerifier Orchestrator", () => {
    it("successfully verifies valid venue network claim and grants GIGABIT_VERIFIED", async () => {
      const verifier = new GigabitSpeedVerifier({
        wasmPath: WASM_PATH,
        zkeyPath: ZKEY_PATH,
        vkeyPath: VKEY_PATH,
      });

      const result = await verifier.verifyVenueNetworkClaim({
        venueId: "venue-gigabit-coworking",
        measurements: validMeasurements,
      });

      expect(result.verified).toBe(true);
      expect(result.claim).toBe("GIGABIT_VERIFIED");
      expect(result.venueId).toBe("venue-gigabit-coworking");
      expect(result.publicSignals).toHaveLength(3);
      expect(result.commitment).toBeDefined();

      // Ensure private telemetry logs are NOT in result
      expect((result as any).measurements).toBeUndefined();
      expect((result as any).downloadSpeedsScaled).toBeUndefined();
      expect((result as any).packetLossPpm).toBeUndefined();
      expect((result as any).ipAddress).toBeUndefined();
      expect((result as any).routerMetadata).toBeUndefined();
    }, 20_000);

    it("rejects sub-gigabit network claims without generating invalid cryptographic proofs", async () => {
      const verifier = new GigabitSpeedVerifier({
        wasmPath: WASM_PATH,
        zkeyPath: ZKEY_PATH,
        vkeyPath: VKEY_PATH,
      });

      const slowMeasurements: NetworkMeasurement[] = [
        { downloadMbps: 850.0, packetLossPercent: 0.01 },
        { downloadMbps: 900.0, packetLossPercent: 0.01 },
        { downloadMbps: 920.0, packetLossPercent: 0.02 },
        { downloadMbps: 890.0, packetLossPercent: 0.01 },
        { downloadMbps: 910.0, packetLossPercent: 0.02 },
      ];

      const result = await verifier.verifyVenueNetworkClaim({
        venueId: "venue-slow-cafe",
        measurements: slowMeasurements,
      });

      expect(result.verified).toBe(false);
      expect(result.claim).toBe("REJECTED");
      expect(result.error).toContain("strictly greater than 1000 Mbps");
    });
  });

  describe("Worker Message Handling & Background Integration", () => {
    it("handles GENERATE_GIGABIT_PROOF worker messages with monotonic progress and complete proof", async () => {
      const posted: ZkpWorkerOutgoingMessage[] = [];
      const emit = (msg: ZkpWorkerOutgoingMessage) => posted.push(msg);

      const request: ZkpProofRequest = {
        type: "GENERATE_GIGABIT_PROOF",
        requestId: "req-gigabit-001",
        payload: {
          venueId: "venue-worker-gigabit-test",
          measurements: validMeasurements,
          salt: 55555n,
        },
      };

      handleZkpWorkerMessage(request, emit);

      // Wait for asynchronous proof computation to complete
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (posted.some((m) => m.type === "PROOF_COMPLETE" || m.type === "PROOF_ERROR")) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });

      const progressStages = posted.filter((m) => m.type === "PROOF_PROGRESS").map((m: any) => m.stage);
      expect(progressStages).toContain("witness");
      expect(progressStages).toContain("proving");

      const success = posted.find((m) => m.type === "PROOF_COMPLETE") as any;
      expect(success).toBeDefined();
      expect(success.requestId).toBe("req-gigabit-001");
      expect(success.proof.pi_a).toHaveLength(3);
      expect(success.proof.publicSignals).toEqual([
        "100000",
        "1000",
        expect.any(String),
      ]);

      // Ensure private witness data is NOT exposed in worker message
      expect(success.measurements).toBeUndefined();
      expect(success.downloadSpeedsScaled).toBeUndefined();
      expect(success.packetLossPpm).toBeUndefined();
    }, 20_000);

    it("emits PROOF_ERROR in worker on sub-gigabit measurements", async () => {
      const posted: ZkpWorkerOutgoingMessage[] = [];
      const emit = (msg: ZkpWorkerOutgoingMessage) => posted.push(msg);

      const subGigabit: NetworkMeasurement[] = Array(5).fill({
        downloadMbps: 800,
        packetLossPercent: 0.01,
      });

      const request: ZkpProofRequest = {
        type: "GENERATE_GIGABIT_PROOF",
        requestId: "req-gigabit-err",
        payload: {
          venueId: "venue-slow",
          measurements: subGigabit,
        },
      };

      handleZkpWorkerMessage(request, emit);

      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (posted.some((m) => m.type === "PROOF_COMPLETE" || m.type === "PROOF_ERROR")) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });

      const errorMsg = posted.find((m) => m.type === "PROOF_ERROR") as any;
      expect(errorMsg).toBeDefined();
      expect(errorMsg.requestId).toBe("req-gigabit-err");
      expect(errorMsg.error).toContain("strictly greater than 1000 Mbps");
    });

    it("handles ABORT message cleanly", async () => {
      const posted: ZkpWorkerOutgoingMessage[] = [];
      const emit = (msg: ZkpWorkerOutgoingMessage) => posted.push(msg);

      handleZkpWorkerMessage(
        {
          type: "ABORT",
          requestId: "req-abort-1",
        },
        emit,
      );

      expect(posted).toHaveLength(0);
    });
  });

  describe("Gigabit Verified Badge Safety & Gating", () => {
    it("never grants verified badge status from an unverified client boolean without cryptographic proof", async () => {
      const verifier = new GigabitSpeedVerifier({
        wasmPath: WASM_PATH,
        zkeyPath: ZKEY_PATH,
        vkeyPath: VKEY_PATH,
      });

      // Untrusted client claim attempting to assert isVerified: true with failing measurements
      const untrustedClientClaim: any = {
        venueId: "venue-untrusted-claim",
        isVerified: true, // Should never be trusted!
        measurements: [
          { downloadMbps: 500, packetLossPercent: 0.01 },
          { downloadMbps: 600, packetLossPercent: 0.02 },
          { downloadMbps: 700, packetLossPercent: 0.01 },
          { downloadMbps: 550, packetLossPercent: 0.03 },
          { downloadMbps: 650, packetLossPercent: 0.01 },
        ],
      };

      const result = await verifier.verifyVenueNetworkClaim(untrustedClientClaim);
      expect(result.verified).toBe(false);
      expect(result.claim).toBe("REJECTED");
    });

    it("rejects verification when public signals are missing or malformed", async () => {
      const input: GigabitProofInput = {
        venueId: "venue-malformed-signals",
        measurements: validMeasurements,
      };

      const { proof } = await generateGigabitProof(input, {
        wasmPath: WASM_PATH,
        zkeyPath: ZKEY_PATH,
      });

      // Missing signals
      expect(await verifyGigabitProof(proof, [], { vkeyPath: VKEY_PATH })).toBe(false);
      // Malformed signals (incorrect length)
      expect(await verifyGigabitProof(proof, ["100000"], { vkeyPath: VKEY_PATH })).toBe(false);
      // Malformed signals (null / undefined values)
      expect(await verifyGigabitProof(null as any, ["100000", "1000", "123"], { vkeyPath: VKEY_PATH })).toBe(false);
    });

    it("benchmarks proof generation to ensure target is reliably under 3 seconds", async () => {
      const input: GigabitProofInput = {
        venueId: "venue-benchmark",
        measurements: validMeasurements,
      };

      const startTime = Date.now();
      const { proof, publicSignals, durationMs } = await generateGigabitProof(input, {
        wasmPath: WASM_PATH,
        zkeyPath: ZKEY_PATH,
      });
      const totalElapsed = Date.now() - startTime;

      expect(durationMs).toBeLessThan(3000);
      expect(totalElapsed).toBeLessThan(3000);
      expect(proof).toBeDefined();
      expect(publicSignals).toHaveLength(3);
    }, 15_000);
  });
});
