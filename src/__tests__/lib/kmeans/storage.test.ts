import { computeHmac, verifyHmac } from "../../../lib/kmeans/storage";
import type { CentroidStoragePayload } from "../../../lib/kmeans/types";
import { NUM_CLUSTERS } from "../../../lib/kmeans/types";

function makeTestPayload(): CentroidStoragePayload {
  return {
    centroids: Array.from({ length: NUM_CLUSTERS }, (_, i) => ({
      wifiQuality: i / NUM_CLUSTERS,
      hasOutlets: 0.5,
      outletDensity: 0.5,
      noiseLevel: 0.5,
      hasErgonomic: 0.5,
      hasPhoneBooths: 0.5,
      hasNoMusic: 0.5,
      hasQuietZone: 0.5,
      hasAncHeadsetRental: 0.5,
      lighting: 0.5,
      currentOccupancy: 0.5,
      rating: 0.5,
    })),
    k: NUM_CLUSTERS,
    version: 1,
    computedAt: Date.now(),
    dataPoints: 100,
  };
}

describe("HMAC Storage", () => {
  describe("computeHmac", () => {
    it("returns a hex string of length 64", async () => {
      const hmac = await computeHmac(makeTestPayload());
      expect(typeof hmac).toBe("string");
      expect(hmac).toMatch(/^[0-9a-f]+$/);
      expect(hmac.length).toBe(64);
    });

    it("is deterministic for the same payload", async () => {
      const payload = makeTestPayload();
      const h1 = await computeHmac(payload);
      const h2 = await computeHmac(payload);
      expect(h1).toBe(h2);
    });

    it("changes when payload changes", async () => {
      const p1 = makeTestPayload();
      const p2 = { ...p1, dataPoints: 999 };
      const h1 = await computeHmac(p1);
      const h2 = await computeHmac(p2);
      expect(h1).not.toBe(h2);
    });
  });

  describe("verifyHmac", () => {
    it("returns true for valid HMAC", async () => {
      const payload = makeTestPayload();
      const hmac = await computeHmac(payload);
      expect(await verifyHmac(payload, hmac)).toBe(true);
    });

    it("returns false for tampered HMAC", async () => {
      const payload = makeTestPayload();
      const hmac = await computeHmac(payload);
      const firstChar = hmac[0];
      const replacement = firstChar === "a" ? "b" : "a";
      const tampered = replacement + hmac.slice(1);
      expect(await verifyHmac(payload, tampered)).toBe(false);
    });

    it("returns false for tampered payload", async () => {
      const payload = makeTestPayload();
      const hmac = await computeHmac(payload);
      const tampered = { ...payload, dataPoints: 999 };
      expect(await verifyHmac(tampered, hmac)).toBe(false);
    });

    it("returns false for empty HMAC", async () => {
      expect(await verifyHmac(makeTestPayload(), "")).toBe(false);
    });
  });
});
