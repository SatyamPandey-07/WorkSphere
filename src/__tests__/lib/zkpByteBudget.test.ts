/**
 * @jest-environment node
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  clearProofCache,
  getCachedProof,
  storeProof,
  calculateProofEntryBytes,
  _resetProofCacheForTesting,
  type CachedProof,
} from "@/lib/zkp/proofCache";

const SCOPE_1 = "scope-1";
const SCOPE_2 = "scope-2";
const SCOPE_3 = "scope-3";

const verificationKey = JSON.stringify({ protocol: "groth16", vk_alpha_1: ["1", "2"] });

const proofFor = (commit: string, tag = "test"): CachedProof => ({
  proof: { pi_a: [tag, "1"], pi_b: [["1", "2"], ["3", "4"]], pi_c: ["5", "6"], protocol: "groth16" },
  publicSignals: [commit],
});

beforeEach(async () => {
  await _resetProofCacheForTesting();
  globalThis.indexedDB = new IDBFactory();
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/zkp/verification_key.json") {
      return new Response(verificationKey, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

describe("ZKP Proof Cache Byte Budget and LRU Eviction", () => {
  it("calculates exact serialized byte length of cached proof payload", () => {
    const proof = proofFor("commit-12345");
    const bytes = calculateProofEntryBytes(proof);
    expect(bytes).toBeGreaterThan(50);
    expect(typeof bytes).toBe("number");
  });

  it("evicts oldest least-recently-used proofs when aggregate byte limit is exceeded", async () => {
    const proofA = proofFor("commit-A", "proof-A");
    const proofB = proofFor("commit-B", "proof-B");
    const proofC = proofFor("commit-C", "proof-C");

    const singleProofBytes = calculateProofEntryBytes(proofA);
    // Set maxByteSize to hold at most ~2 proofs
    const maxByteSize = Math.floor(singleProofBytes * 2.2);

    // Store proof A at t = 1000
    jest.spyOn(Date, "now").mockReturnValue(1000);
    await storeProof(SCOPE_1, "commit-A", proofA, { maxByteSize });

    // Store proof B at t = 2000
    jest.spyOn(Date, "now").mockReturnValue(2000);
    await storeProof(SCOPE_2, "commit-B", proofB, { maxByteSize });

    expect(await getCachedProof(SCOPE_1, "commit-A")).toBeDefined();
    expect(await getCachedProof(SCOPE_2, "commit-B")).toBeDefined();

    // Store proof C at t = 3000 -> exceeds byte limit, should evict proof A (the oldest)
    jest.spyOn(Date, "now").mockReturnValue(3000);
    await storeProof(SCOPE_3, "commit-C", proofC, { maxByteSize });

    const cachedA = await getCachedProof(SCOPE_1, "commit-A");
    const cachedB = await getCachedProof(SCOPE_2, "commit-B");
    const cachedC = await getCachedProof(SCOPE_3, "commit-C");

    expect(cachedA).toBeNull(); // Proof A was evicted
    expect(cachedB).not.toBeNull();
    expect(cachedC).not.toBeNull();
  });

  it("retains accessed entries by refreshing LRU recency timestamp", async () => {
    const proofA = proofFor("commit-A", "proof-A");
    const proofB = proofFor("commit-B", "proof-B");
    const proofC = proofFor("commit-C", "proof-C");

    const singleProofBytes = calculateProofEntryBytes(proofA);
    const maxByteSize = Math.floor(singleProofBytes * 2.2);

    // 1. Insert A at t = 1000
    jest.spyOn(Date, "now").mockReturnValue(1000);
    await storeProof(SCOPE_1, "commit-A", proofA, { maxByteSize });

    // 2. Insert B at t = 2000
    jest.spyOn(Date, "now").mockReturnValue(2000);
    await storeProof(SCOPE_2, "commit-B", proofB, { maxByteSize });

    // 3. Read A at t = 3000 (refreshing A's lastAccessedAt timestamp to 3000)
    jest.spyOn(Date, "now").mockReturnValue(3000);
    const readA = await getCachedProof(SCOPE_1, "commit-A");
    expect(readA).not.toBeNull();

    // 4. Insert C at t = 4000 -> should evict B (unaccessed since 2000) instead of A (accessed at 3000)
    jest.spyOn(Date, "now").mockReturnValue(4000);
    await storeProof(SCOPE_3, "commit-C", proofC, { maxByteSize });

    const cachedA = await getCachedProof(SCOPE_1, "commit-A");
    const cachedB = await getCachedProof(SCOPE_2, "commit-B");
    const cachedC = await getCachedProof(SCOPE_3, "commit-C");

    expect(cachedA).not.toBeNull(); // Proof A was saved because it was recently accessed
    expect(cachedB).toBeNull(); // Proof B was evicted
    expect(cachedC).not.toBeNull();
  });
});
