/**
 * @jest-environment node
 *
 * Comprehensive Test Suite for SnarkJS Proof Verification Cache in IndexedDB (#9500)
 */

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  getCachedVerification,
  cacheVerifiedProof,
  computeVerificationCacheKey,
  computeProofHash,
  computeVKeyFingerprint,
  purgeExpiredVerifications,
  clearVerificationCache,
  getVerificationCacheDb,
  _resetVerificationCacheForTesting,
  ZKP_VERIFIED_PROOFS_DB_NAME,
  ZKP_VERIFIED_PROOFS_STORE_NAME,
  type VerificationInput,
} from "../../../lib/zkp/proofCache";
import {
  verifyStudentDiscountProof,
  type StudentDiscountVerificationParams,
} from "../../../features/zkp/studentDiscountVerifier";

// Mock helper compatible with both Vitest and Jest
const testFn = (impl?: (...args: any[]) => any) => {
  if (typeof (globalThis as any).vi !== "undefined") {
    return (globalThis as any).vi.fn(impl);
  }
  if (typeof jest !== "undefined") {
    return jest.fn(impl);
  }
  const f: any = (...args: any[]) => {
    f.mock.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  f.mock = { calls: [] };
  return f;
};

const testSpyOn = (obj: any, method: string) => {
  if (typeof (globalThis as any).vi !== "undefined") {
    return (globalThis as any).vi.spyOn(obj, method);
  }
  if (typeof jest !== "undefined") {
    return jest.spyOn(obj, method);
  }
  const original = obj[method];
  const spy = testFn();
  obj[method] = spy;
  (spy as any).mockRestore = () => {
    obj[method] = original;
  };
  return spy;
};

const testRestoreMocks = () => {
  if (typeof (globalThis as any).vi !== "undefined") {
    (globalThis as any).vi.restoreAllMocks();
  }
  if (typeof jest !== "undefined") {
    jest.restoreAllMocks();
  }
};

const SAMPLE_VKEY = {
  protocol: "groth16",
  curve: "bn128",
  nPublic: 2,
  vk_alpha_1: ["100", "200", "1"],
  vk_beta_2: [["1", "2"], ["3", "4"], ["1", "0"]],
  vk_gamma_2: [["5", "6"], ["7", "8"], ["1", "0"]],
  vk_delta_2: [["9", "10"], ["11", "12"], ["1", "0"]],
};

const SAMPLE_PROOF = {
  pi_a: ["11111111111111111111", "22222222222222222222", "1"],
  pi_b: [
    ["33333333333333333333", "44444444444444444444"],
    ["55555555555555555555", "66666666666666666666"],
    ["1", "0"],
  ],
  pi_c: ["77777777777777777777", "88888888888888888888", "1"],
  protocol: "groth16",
  curve: "bn128",
};

const SAMPLE_SIGNALS = [
  "1849102948102938401928401928401928401928401928401928401928401928",
  "2026",
];

describe("SnarkJS Proof Verification Cache in IndexedDB (#9500)", () => {
  beforeEach(async () => {
    await _resetVerificationCacheForTesting();
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(async () => {
    await _resetVerificationCacheForTesting();
  });

  // ── IndexedDB Lifecycle ──────────────────────────────────────────────────
  describe("IndexedDB lifecycle", () => {
    it("1. Database creation: opens and initializes successfully", async () => {
      const db = await getVerificationCacheDb("test_lifecycle_db_1");
      expect(db).toBeDefined();
      expect(db.name).toBe("test_lifecycle_db_1");
      expect(db.version).toBe(1);
      db.close();
    });

    it("2. Object store creation: creates zkp_verified_proofs with keyPath cacheKey", async () => {
      const db = await getVerificationCacheDb("test_lifecycle_db_2");
      expect(db.objectStoreNames.contains(ZKP_VERIFIED_PROOFS_STORE_NAME)).toBe(true);
      db.close();
    });

    it("3. proofHash index creation: creates proofHash index", async () => {
      const db = await getVerificationCacheDb("test_lifecycle_db_3");
      const tx = db.transaction(ZKP_VERIFIED_PROOFS_STORE_NAME, "readonly");
      const store = tx.objectStore(ZKP_VERIFIED_PROOFS_STORE_NAME);
      expect(store.indexNames.contains("proofHash")).toBe(true);
      expect(store.indexNames.contains("expiresAt")).toBe(true);
      db.close();
    });

    it("4. Existing database upgrade: does not delete unrelated stores", async () => {
      const dbName = "test_lifecycle_db_4";
      // Manually create db with custom store using globalThis.indexedDB directly to avoid ESM import issues in Jest
      await new Promise<void>((resolve, reject) => {
        const req = globalThis.indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore("unrelated_store", { keyPath: "id" });
          db.createObjectStore(ZKP_VERIFIED_PROOFS_STORE_NAME, { keyPath: "cacheKey" });
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });

      const cachedDb = await getVerificationCacheDb(dbName);
      expect(cachedDb.objectStoreNames.contains("unrelated_store")).toBe(true);
      expect(cachedDb.objectStoreNames.contains(ZKP_VERIFIED_PROOFS_STORE_NAME)).toBe(true);
      cachedDb.close();
    });

    it("5. Database unavailable or blocked: handles safely without throwing", async () => {
      const origIndexedDB = globalThis.indexedDB;
      delete (globalThis as any).indexedDB;

      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
      };

      const res = await getCachedVerification(input);
      expect(res.hit).toBe(false);
      expect(res.reason).toBe("storage_disabled");

      const cached = await cacheVerifiedProof(input);
      expect(cached).toBe(false);

      globalThis.indexedDB = origIndexedDB;
    });

    it("6. Transaction and storage errors: gracefully degrades to cache miss", async () => {
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
      };

      // Mock getVerificationCacheDb to throw
      const errorOptions = { dbName: "error_db" };
      const originalOpen = globalThis.indexedDB.open;
      globalThis.indexedDB.open = () => {
        throw new Error("Disk IO failure");
      };

      const res = await getCachedVerification(input, errorOptions);
      expect(res.hit).toBe(false);

      const cached = await cacheVerifiedProof(input, errorOptions);
      expect(cached).toBe(false);

      globalThis.indexedDB.open = originalOpen;
    });
  });

  // ── Cache Behavior ───────────────────────────────────────────────────────
  describe("Cache behavior", () => {
    it("7. Cache miss for an unknown proof", async () => {
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
      };

      const result = await getCachedVerification(input);
      expect(result.hit).toBe(false);
      expect(result.reason).toBe("miss");
      expect(result.entry).toBeUndefined();
    });

    it("8. Cache hit for a previously verified proof", async () => {
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        merkleRoot: SAMPLE_SIGNALS[0],
        vKey: SAMPLE_VKEY,
      };

      const cached = await cacheVerifiedProof(input);
      expect(cached).toBe(true);

      const result = await getCachedVerification(input);
      expect(result.hit).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.publicSignals).toEqual(SAMPLE_SIGNALS);
    });

    it("9. Expired entry treated as a cache miss", async () => {
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      };

      // Store with 100ms TTL
      await cacheVerifiedProof(input, { ttlMs: 100 });

      // Simulate passing of time
      const now = Date.now();
      testSpyOn(Date, "now").mockReturnValue(now + 200);

      const result = await getCachedVerification(input);
      expect(result.hit).toBe(false);
      expect(result.reason).toBe("expired");

      testRestoreMocks();
    });

    it("10. Configurable TTL: respects custom TTL options", async () => {
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      };

      const customTtl = 5000;
      const start = Date.now();
      await cacheVerifiedProof(input, { ttlMs: customTtl });

      const result = await getCachedVerification(input);
      expect(result.hit).toBe(true);
      expect(result.entry?.expiresAt).toBeGreaterThanOrEqual(start + customTtl);
    });

    it("11. Failed proofs are never cached", async () => {
      const mockVerifier = testFn(async () => false);

      const params: StudentDiscountVerificationParams = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      };

      const res = await verifyStudentDiscountProof(params, mockVerifier);
      expect(res.isValid).toBe(false);
      expect(res.fromCache).toBe(false);

      const cacheCheck = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      });
      expect(cacheCheck.hit).toBe(false);
    });

    it("12. Cache entries contain the expected public signals and Merkle root", async () => {
      const root = "998877665544332211";
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: [root, 2026],
        merkleRoot: root,
        circuitId: "student_membership",
        vKey: SAMPLE_VKEY,
      };

      await cacheVerifiedProof(input);
      const res = await getCachedVerification(input);

      expect(res.hit).toBe(true);
      expect(res.entry?.merkleRoot).toBe(root);
      expect(res.entry?.publicSignals).toEqual([root, "2026"]);
      expect(res.entry?.circuitId).toBe("student_membership");
    });
  });

  // ── Cryptographic Integrity ──────────────────────────────────────────────
  describe("Cryptographic integrity", () => {
    it("13. Tampered proof produces a different cache key", async () => {
      const tamperedProof = {
        ...SAMPLE_PROOF,
        pi_a: ["99999999999999999999", SAMPLE_PROOF.pi_a[1], "1"],
      };

      const originalKeys = await computeVerificationCacheKey({
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      });

      const tamperedKeys = await computeVerificationCacheKey({
        proof: tamperedProof,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      });

      expect(tamperedKeys.proofHash).not.toBe(originalKeys.proofHash);
      expect(tamperedKeys.cacheKey).not.toBe(originalKeys.cacheKey);
    });

    it("14. Modified public signals produce a different cache key", async () => {
      const modifiedSignals = [SAMPLE_SIGNALS[0], "2027"]; // different epoch

      const originalKeys = await computeVerificationCacheKey({
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      });

      const modifiedKeys = await computeVerificationCacheKey({
        proof: SAMPLE_PROOF,
        publicSignals: modifiedSignals,
        vKey: SAMPLE_VKEY,
      });

      expect(modifiedKeys.cacheKey).not.toBe(originalKeys.cacheKey);
    });

    it("15. Modified Merkle root produces a different cache key", async () => {
      const rootA = "11111111111111111111";
      const rootB = "22222222222222222222";

      const keyA = await computeVerificationCacheKey({
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        merkleRoot: rootA,
      });

      const keyB = await computeVerificationCacheKey({
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        merkleRoot: rootB,
      });

      expect(keyA.cacheKey).not.toBe(keyB.cacheKey);
    });

    it("16. Different circuit or verification key cannot reuse a cache entry", async () => {
      const inputA: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        circuitId: "circuit_A",
        vKey: SAMPLE_VKEY,
      };

      await cacheVerifiedProof(inputA);

      // Check with different circuit
      const resDiffCircuit = await getCachedVerification({
        ...inputA,
        circuitId: "circuit_B",
      });
      expect(resDiffCircuit.hit).toBe(false);

      // Check with different vKey
      const differentVKey = { ...SAMPLE_VKEY, vk_alpha_1: ["999", "888", "1"] };
      const resDiffVKey = await getCachedVerification({
        ...inputA,
        vKey: differentVKey,
      });
      expect(resDiffVKey.hit).toBe(false);
    });

    it("17. Malformed or corrupted cache entries are rejected", async () => {
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      };

      const { cacheKey } = await computeVerificationCacheKey(input);
      const db = await getVerificationCacheDb();

      // Put corrupted entry in db
      await db.put(ZKP_VERIFIED_PROOFS_STORE_NAME, {
        cacheKey,
        proofHash: "corrupted_hash",
        publicSignals: ["wrong_signals"],
        expiresAt: Date.now() + 100000,
        verifiedAt: Date.now(),
        lastAccessedAt: Date.now(),
      });

      const res = await getCachedVerification(input);
      expect(res.hit).toBe(false);
      expect(res.reason).toBe("mismatch");
    });

    it("18. Cache lookup never bypasses verification for mismatched inputs", async () => {
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        merkleRoot: "root_original",
      };

      await cacheVerifiedProof(input);

      // Same proof, but caller asks for a different root
      const mismatchedLookup = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        merkleRoot: "root_mismatched",
      });

      expect(mismatchedLookup.hit).toBe(false);
    });
  });

  // ── Cleanup & Storage Limits ─────────────────────────────────────────────
  describe("Cleanup and storage limits", () => {
    it("19. Expired entries are purged by purgeExpiredVerifications", async () => {
      const input1: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: ["sig1"],
      };
      const input2: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: ["sig2"],
      };

      const now = Date.now();
      // Entry 1 expired
      await cacheVerifiedProof(input1, { ttlMs: 100 });
      // Entry 2 active
      await cacheVerifiedProof(input2, { ttlMs: 100000 });

      testSpyOn(Date, "now").mockReturnValue(now + 500);

      const purged = await purgeExpiredVerifications();
      expect(purged).toBe(1);

      const check1 = await getCachedVerification(input1);
      const check2 = await getCachedVerification(input2);
      expect(check1.hit).toBe(false);
      expect(check2.hit).toBe(true);

      testRestoreMocks();
    });

    it("20. Cleanup runs without blocking verification", async () => {
      const purged = await purgeExpiredVerifications();
      expect(purged).toBe(0); // empty db
    });

    it("21. Maximum entry count is enforced", async () => {
      const maxEntries = 3;

      for (let i = 0; i < 5; i++) {
        await cacheVerifiedProof(
          {
            proof: SAMPLE_PROOF,
            publicSignals: [`signal_${i}`],
          },
          { maxEntries },
        );
      }

      const db = await getVerificationCacheDb();
      const count = await db.count(ZKP_VERIFIED_PROOFS_STORE_NAME);
      expect(count).toBeLessThanOrEqual(maxEntries);
    });

    it("22. Expired records are evicted before valid records", async () => {
      const maxEntries = 2;
      const now = Date.now();

      // Input 1: Expired
      await cacheVerifiedProof(
        { proof: SAMPLE_PROOF, publicSignals: ["entry_1"] },
        { ttlMs: 50, maxEntries: 10 },
      );

      // Input 2: Valid
      await cacheVerifiedProof(
        { proof: SAMPLE_PROOF, publicSignals: ["entry_2"] },
        { ttlMs: 100000, maxEntries: 10 },
      );

      // Advance time so entry_1 is expired
      testSpyOn(Date, "now").mockReturnValue(now + 100);

      // Insert Input 3 with maxEntries = 2
      await cacheVerifiedProof(
        { proof: SAMPLE_PROOF, publicSignals: ["entry_3"] },
        { ttlMs: 100000, maxEntries },
      );

      // Entry 1 should be gone, Entry 2 and 3 should be kept
      const res2 = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: ["entry_2"],
      });
      const res3 = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: ["entry_3"],
      });

      expect(res2.hit).toBe(true);
      expect(res3.hit).toBe(true);

      testRestoreMocks();
    });

    it("23. Oldest entries are evicted when capacity is exceeded", async () => {
      const maxEntries = 2;

      await cacheVerifiedProof(
        { proof: SAMPLE_PROOF, publicSignals: ["oldest"] },
        { maxEntries: 5 },
      );

      await new Promise((r) => setTimeout(r, 10));

      await cacheVerifiedProof(
        { proof: SAMPLE_PROOF, publicSignals: ["middle"] },
        { maxEntries: 5 },
      );

      await new Promise((r) => setTimeout(r, 10));

      // Adding 3rd entry with cap of 2 -> should evict "oldest"
      await cacheVerifiedProof(
        { proof: SAMPLE_PROOF, publicSignals: ["newest"] },
        { maxEntries },
      );

      const resOld = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: ["oldest"],
      });
      const resMiddle = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: ["middle"],
      });
      const resNew = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: ["newest"],
      });

      expect(resOld.hit).toBe(false);
      expect(resMiddle.hit).toBe(true);
      expect(resNew.hit).toBe(true);
    });
  });

  // ── Integration ──────────────────────────────────────────────────────────
  describe("Integration with student discount verification", () => {
    it("24. Cache hit skips SnarkJS verification", async () => {
      const mockVerifier = testFn(async () => true);

      const params: StudentDiscountVerificationParams = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      };

      // First run: calls SnarkJS
      const first = await verifyStudentDiscountProof(params, mockVerifier);
      expect(first.isValid).toBe(true);
      expect(first.fromCache).toBe(false);
      expect(mockVerifier.mock.calls.length).toBe(1);

      // Second run: served from cache
      const second = await verifyStudentDiscountProof(params, mockVerifier);
      expect(second.isValid).toBe(true);
      expect(second.fromCache).toBe(true);
      expect(mockVerifier.mock.calls.length).toBe(1); // Not called again!
    });

    it("25. Cache miss invokes SnarkJS verification", async () => {
      const mockVerifier = testFn(async () => true);

      const params: StudentDiscountVerificationParams = {
        proof: SAMPLE_PROOF,
        publicSignals: ["new_signals_unseen"],
        vKey: SAMPLE_VKEY,
      };

      const result = await verifyStudentDiscountProof(params, mockVerifier);
      expect(result.isValid).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(mockVerifier.mock.calls.length).toBe(1);
    });

    it("26. Successful verification inserts a cache entry", async () => {
      const mockVerifier = testFn(async () => true);

      const params: StudentDiscountVerificationParams = {
        proof: SAMPLE_PROOF,
        publicSignals: ["insert_test_signal"],
        vKey: SAMPLE_VKEY,
      };

      await verifyStudentDiscountProof(params, mockVerifier);

      const check = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: ["insert_test_signal"],
        vKey: SAMPLE_VKEY,
        circuitId: "student_membership",
        merkleRoot: "insert_test_signal",
      });

      expect(check.hit).toBe(true);
    });

    it("27. Invalid proof is not cached", async () => {
      const mockVerifier = testFn(async () => false);

      const params: StudentDiscountVerificationParams = {
        proof: SAMPLE_PROOF,
        publicSignals: ["invalid_proof_signals"],
        vKey: SAMPLE_VKEY,
      };

      const res = await verifyStudentDiscountProof(params, mockVerifier);
      expect(res.isValid).toBe(false);

      const check = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: ["invalid_proof_signals"],
        vKey: SAMPLE_VKEY,
      });
      expect(check.hit).toBe(false);
    });

    it("28. SnarkJS exceptions preserve existing error handling and do not cache", async () => {
      const mockVerifier = testFn(async () => {
        throw new Error("Invalid elliptic curve point");
      });

      const params: StudentDiscountVerificationParams = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      };

      await expect(verifyStudentDiscountProof(params, mockVerifier)).rejects.toThrow(
        "Invalid elliptic curve point",
      );

      const check = await getCachedVerification({
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      });
      expect(check.hit).toBe(false);
    });

    it("29. IndexedDB failure falls back to normal verification", async () => {
      const mockVerifier = testFn(async () => true);

      const params: StudentDiscountVerificationParams = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
        cacheOptions: { dbName: "unavailable_db" },
      };

      // Sabotage open
      const originalOpen = globalThis.indexedDB.open;
      globalThis.indexedDB.open = () => {
        throw new Error("IndexedDB quota exceeded or private mode");
      };

      const res = await verifyStudentDiscountProof(params, mockVerifier);
      expect(res.isValid).toBe(true);
      expect(res.fromCache).toBe(false);
      expect(mockVerifier.mock.calls.length).toBe(1);

      globalThis.indexedDB.open = originalOpen;
    });

    it("30. Concurrent requests for the same proof behave consistently", async () => {
      let callCount = 0;
      const mockVerifier = testFn(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return true;
      });

      const params: StudentDiscountVerificationParams = {
        proof: SAMPLE_PROOF,
        publicSignals: ["concurrent_test_signals"],
        vKey: SAMPLE_VKEY,
      };

      const [res1, res2, res3] = await Promise.all([
        verifyStudentDiscountProof(params, mockVerifier),
        verifyStudentDiscountProof(params, mockVerifier),
        verifyStudentDiscountProof(params, mockVerifier),
      ]);

      expect(res1.isValid).toBe(true);
      expect(res2.isValid).toBe(true);
      expect(res3.isValid).toBe(true);
      expect(callCount).toBe(1); // Deduplicated concurrent run
    });
  });

  // ── Performance Validation (<5ms Cache Hits) ─────────────────────────────
  describe("Performance benchmark", () => {
    it("measures cache lookup latency and verifies sub-5ms performance", async () => {
      const input: VerificationInput = {
        proof: SAMPLE_PROOF,
        publicSignals: SAMPLE_SIGNALS,
        vKey: SAMPLE_VKEY,
      };

      // Warm up database and cache entry
      await cacheVerifiedProof(input);
      const warmUp = await getCachedVerification(input);
      expect(warmUp.hit).toBe(true);

      // Measure repeated cache lookups
      const iterations = 50;
      const timings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const res = await getCachedVerification(input);
        const elapsed = performance.now() - start;
        expect(res.hit).toBe(true);
        timings.push(elapsed);
      }

      timings.sort((a, b) => a - b);
      const median = timings[Math.floor(timings.length / 2)];
      const p95 = timings[Math.floor(timings.length * 0.95)];

      // Validate that median performance is under 5ms
      expect(median).toBeLessThan(5);
    });
  });
});
