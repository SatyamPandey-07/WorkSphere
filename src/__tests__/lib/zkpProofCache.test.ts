/**
 * @jest-environment node
 *
 * IndexedDB proof cache for zk-SNARK membership proofs (#3358).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  clearProofCache,
  getCachedProof,
  getOrCreateProof,
  invalidateProof,
  storeProof,
  _resetProofCacheForTesting,
  type CachedProof,
} from "@/lib/zkp/proofCache";
import { provePremiumAccess, PREMIUM_PROOF_SCOPE } from "@/lib/zkp/client";
import { computeMembershipCommit } from "@/lib/zkp/commitment";

const SCOPE = "premium-membership";
const COMMIT = "1234567890";

let verificationKey = JSON.stringify({ protocol: "groth16", vk_alpha_1: ["1", "2"] });
let venueResponses: Array<{ status: number; body: Record<string, unknown> }> = [];
const fetchMock = jest.fn(async (url: string) => {
  if (url === "/zkp/verification_key.json") {
    return new Response(verificationKey, { status: 200 });
  }
  if (url.includes("/zkp-access")) {
    const next = venueResponses.shift() ?? { status: 200, body: { allowed: true, accessToken: "tok" } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }
  return new Response("not found", { status: 404 });
});

const proofFor = (commit: string, tag = "a"): CachedProof => ({
  proof: { pi_a: [tag, "1"], pi_b: [["1", "2"], ["3", "4"]], pi_c: ["5", "6"], protocol: "groth16" },
  publicSignals: [commit],
});

beforeEach(async () => {
  await _resetProofCacheForTesting();
  globalThis.indexedDB = new IDBFactory(); // fresh database per test
  verificationKey = JSON.stringify({ protocol: "groth16", vk_alpha_1: ["1", "2"] });
  venueResponses = [];
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

describe("getOrCreateProof", () => {
  it("proves once, then serves repeat checks from IndexedDB in under 50 ms", async () => {
    const generate = jest.fn(async () => proofFor(COMMIT));

    const first = await getOrCreateProof({ scope: SCOPE, commit: COMMIT, generate });
    expect(first.source).toBe("generated");

    const timings: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      const hit = await getOrCreateProof({ scope: SCOPE, commit: COMMIT, generate });
      timings.push(performance.now() - t);
      expect(hit.source).toBe("cache");
      expect(hit.publicSignals).toEqual([COMMIT]);
    }
    expect(generate).toHaveBeenCalledTimes(1);
    timings.sort((a, b) => a - b);
    expect(timings[timings.length >> 1]).toBeLessThan(50);
  });

  it("serves a stale proof immediately and regenerates it in the background", async () => {
    const generate = jest.fn(async () => proofFor(COMMIT, "fresh"));
    await storeProof(SCOPE, COMMIT, proofFor(COMMIT, "old"), { freshMs: 1000, maxAgeMs: 60_000 });

    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now + 5000); // stale, not expired
    const result = await getOrCreateProof({ scope: SCOPE, commit: COMMIT, generate });

    expect(result.source).toBe("stale-cache");
    expect((result.proof as { pi_a: string[] }).pi_a[0]).toBe("old");
    await new Promise((r) => setTimeout(r, 20));
    expect(generate).toHaveBeenCalledTimes(1);

    const refreshed = await getCachedProof(SCOPE, COMMIT);
    expect((refreshed!.proof as { pi_a: string[] }).pi_a[0]).toBe("fresh");
  });

  it("re-proves in the foreground once a proof is past its hard expiry", async () => {
    await storeProof(SCOPE, COMMIT, proofFor(COMMIT, "old"), { freshMs: 1000, maxAgeMs: 2000 });
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 3000);
    const generate = jest.fn(async () => proofFor(COMMIT, "new"));

    const result = await getOrCreateProof({ scope: SCOPE, commit: COMMIT, generate });
    expect(result.source).toBe("generated");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("shares one proving run between concurrent requests", async () => {
    let release!: () => void;
    const generate = jest.fn(
      () => new Promise<CachedProof>((resolve) => (release = () => resolve(proofFor(COMMIT)))),
    );
    const a = getOrCreateProof({ scope: SCOPE, commit: COMMIT, generate });
    const b = getOrCreateProof({ scope: SCOPE, commit: COMMIT, generate });
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([a, b]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("reports background refresh failures without failing the caller", async () => {
    await storeProof(SCOPE, COMMIT, proofFor(COMMIT), { freshMs: 1, maxAgeMs: 60_000 });
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 100);
    const onBackgroundError = jest.fn();
    const result = await getOrCreateProof({
      scope: SCOPE,
      commit: COMMIT,
      generate: async () => {
        throw new Error("worker crashed");
      },
      onBackgroundError,
    });
    expect(result.source).toBe("stale-cache");
    await new Promise((r) => setTimeout(r, 20));
    expect(onBackgroundError).toHaveBeenCalledWith(expect.objectContaining({ message: "worker crashed" }));
  });
});

describe("invalidation", () => {
  it("drops every cached proof when the circuit's verification key changes", async () => {
    await storeProof(SCOPE, COMMIT, proofFor(COMMIT));
    expect(await getCachedProof(SCOPE, COMMIT)).not.toBeNull();

    verificationKey = JSON.stringify({ protocol: "groth16", vk_alpha_1: ["9", "9"] }); // rebuilt circuit
    await _resetProofCacheForTesting(); // new page load: epoch recomputed
    expect(await getCachedProof(SCOPE, COMMIT)).toBeNull();
  });

  it("does not cache when the circuit epoch can't be established", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 500 }));
    await storeProof(SCOPE, COMMIT, proofFor(COMMIT));
    expect(await getCachedProof(SCOPE, COMMIT)).toBeNull();
  });

  it("replaces the previous credential's proof when the identity changes", async () => {
    await storeProof(SCOPE, "111", proofFor("111"));
    await storeProof("student-discount", "111", proofFor("111"));
    await storeProof(SCOPE, "222", proofFor("222"));

    expect(await getCachedProof(SCOPE, "111")).toBeNull();
    expect(await getCachedProof(SCOPE, "222")).not.toBeNull();
    expect(await getCachedProof("student-discount", "111")).not.toBeNull(); // other scope untouched
  });

  it("refuses proofs whose public signal doesn't match the commitment", async () => {
    await storeProof(SCOPE, COMMIT, proofFor("999"));
    expect(await getCachedProof(SCOPE, COMMIT)).toBeNull();
  });

  it("supports explicit invalidation and clearing (e.g. on sign-out)", async () => {
    await storeProof(SCOPE, "111", proofFor("111"));
    await storeProof("student-discount", "222", proofFor("222"));
    await invalidateProof(SCOPE, "111");
    expect(await getCachedProof(SCOPE, "111")).toBeNull();
    await clearProofCache();
    expect(await getCachedProof("student-discount", "222")).toBeNull();
  });
});

// ─── provePremiumAccess integration ───────────────────────────────────────────

class FakeZkpWorker {
  static instances = 0;
  static messages: Array<Record<string, unknown>> = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeZkpWorker.instances++;
  }
  postMessage(msg: Record<string, unknown>) {
    FakeZkpWorker.messages.push(msg);
    if (msg.type !== "prove") return;
    setTimeout(() =>
      this.onmessage?.({
        data: { type: "success", ...proofFor(msg.expectedCommit as string, `p${FakeZkpWorker.instances}`) },
      }),
    );
  }
  terminate() {}
}

describe("provePremiumAccess with the proof cache", () => {
  const IDENTITY = "42";
  const commit = computeMembershipCommit(IDENTITY);

  beforeEach(() => {
    FakeZkpWorker.instances = 0;
    FakeZkpWorker.messages = [];
    (globalThis as unknown as { Worker: unknown }).Worker = FakeZkpWorker;
  });

  it("proves on the first visit and reuses the proof afterwards", async () => {
    const first = await provePremiumAccess({ identityToken: IDENTITY, venueId: "v1" });
    expect(first).toMatchObject({ allowed: true, accessToken: "tok", proofSource: "generated" });

    const second = await provePremiumAccess({ identityToken: IDENTITY, venueId: "v1" });
    expect(second).toMatchObject({ allowed: true, proofSource: "cache" });
    expect(FakeZkpWorker.instances).toBe(1);
    expect(FakeZkpWorker.messages[0]).toMatchObject({ type: "prove", expectedCommit: commit });
  });

  it("never writes the raw identity token to IndexedDB", async () => {
    await provePremiumAccess({ identityToken: "12345678", venueId: "v1" });
    const entry = await getCachedProof(PREMIUM_PROOF_SCOPE, computeMembershipCommit("12345678"));
    expect(entry).not.toBeNull();
    expect(JSON.stringify(entry)).not.toContain("12345678");
  });

  it("evicts a rejected cached proof and re-proves once", async () => {
    await provePremiumAccess({ identityToken: IDENTITY, venueId: "v1" });
    venueResponses = [
      { status: 403, body: { allowed: false, error: "Invalid proof." } },
      { status: 200, body: { allowed: true, accessToken: "tok2" } },
    ];

    const result = await provePremiumAccess({ identityToken: IDENTITY, venueId: "v1" });
    expect(result).toMatchObject({ allowed: true, accessToken: "tok2", proofSource: "generated" });
    expect(FakeZkpWorker.instances).toBe(2);
    expect(await getCachedProof(PREMIUM_PROOF_SCOPE, commit)).not.toBeNull(); // fresh proof cached
  });

  it("does not loop or keep a proof the server rejects outright", async () => {
    venueResponses = [{ status: 403, body: { allowed: false, error: "Commitment has been revoked." } }];
    const result = await provePremiumAccess({ identityToken: IDENTITY, venueId: "v1" });
    expect(result).toMatchObject({ allowed: false, error: "Commitment has been revoked." });
    expect(FakeZkpWorker.instances).toBe(1);
    expect(await getCachedProof(PREMIUM_PROOF_SCOPE, commit)).toBeNull();
  });
});
