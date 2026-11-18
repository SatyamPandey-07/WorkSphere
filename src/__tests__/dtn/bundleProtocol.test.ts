import { describe, it, expect, beforeEach } from "@jest/globals";
import { BundleProtocolEngine } from "@/core/dtn/BundleProtocolEngine";
import "fake-indexeddb/auto";
import { webcrypto } from "crypto";

if (!global.crypto || !global.crypto.subtle) {
  Object.defineProperty(global, "crypto", {
    value: webcrypto,
    writable: true,
  });
}

describe("BundleProtocolEngine RFC 5050 DTN Implementation", () => {
  let nodeA: BundleProtocolEngine;
  let nodeB: BundleProtocolEngine;

  beforeEach(async () => {
    if (globalThis.indexedDB) {
      globalThis.indexedDB.deleteDatabase("worksphere-dtn-store");
    }

    nodeA = new BundleProtocolEngine("node-alpha");
    nodeB = new BundleProtocolEngine("node-beta");
  });

  it("creates, signs, and persists bundles in IndexedDB", async () => {
    const payload = { reviewId: "rev-101", rating: 5, comment: "Great remote cafe!" };
    const bundle = await nodeA.createBundle("node-server", payload, 3600);

    expect(bundle.header.bundleId).toBeDefined();
    expect(bundle.header.sourceEndpoint).toBe("node-alpha");
    expect(bundle.header.signature).toBeDefined();

    const storedBundles = await nodeA.getUnexpiredBundles();
    expect(storedBundles).toHaveLength(1);
    expect(storedBundles[0].payload).toEqual(payload);
  });

  it("exchanges custody of bundles between peers during proximity contact", async () => {
    const payload = { bookingId: "book-202", workspace: "Alpine Hub" };
    await nodeA.createBundle("node-server", payload, 3600);

    const bundlesToExchange = await nodeA.getUnexpiredBundles();
    const acceptedIds = await nodeB.receiveBundlesFromPeer(bundlesToExchange);

    expect(acceptedIds).toHaveLength(1);

    const nodeBBundles = await nodeB.getUnexpiredBundles();
    expect(nodeBBundles).toHaveLength(1);
    expect(nodeBBundles[0].custodyAcceptedBy).toContain("node-beta");
  });

  it("automatically purges expired bundles based on lifetime TTL", async () => {
    const bundle = await nodeA.createBundle("node-server", { test: "data" }, 1);

    bundle.header.creationTimestamp = Date.now() - 5000;

    const db = await (nodeA as any).dbPromise;
    await db.put("dtn-bundles", bundle);

    const unexpired = await nodeA.getUnexpiredBundles();
    expect(unexpired).toHaveLength(0);
  });
});
