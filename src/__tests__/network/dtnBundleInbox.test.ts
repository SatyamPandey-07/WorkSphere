import { DTNBundlesInbox } from "@/core/network/DTNBundlesInbox";

describe("DTNBundlesInbox (#10688)", () => {
  it("assembles out-of-order fragments, survives snapshot restart, and issues application_delivery receipt only after commit", async () => {
    const inbox1 = new DTNBundlesInbox();
    const full = Buffer.from("HelloWorld!", "utf8");
    const part1 = full.subarray(0, 5).toString("base64");
    const part2 = full.subarray(5).toString("base64");
    const t0 = 100_000;

    // Fragment 2 arrives first
    const r2 = inbox1.ingestFragment(
      {
        logicalBundleId: "b-1",
        source: "node-a",
        destination: "core",
        fragmentOffset: 5,
        totalPayloadLength: full.length,
        payloadBase64: part2,
        creationTimestamp: t0,
        lifetimeMs: 60_000,
      },
      t0 + 10,
    );
    expect(r2.accepted).toBe(true);
    expect(r2.status).toBe("assembling");
    expect(r2.receipt?.kind).toBe("transport");

    // Simulate process restart via snapshot
    const snapshot = inbox1.exportSnapshot();
    const inbox2 = new DTNBundlesInbox();
    inbox2.importSnapshot(snapshot);

    // Fragment 1 arrives after restart
    const r1 = inbox2.ingestFragment(
      {
        logicalBundleId: "b-1",
        source: "node-a",
        destination: "core",
        fragmentOffset: 0,
        totalPayloadLength: full.length,
        payloadBase64: part1,
        creationTimestamp: t0,
        lifetimeMs: 60_000,
      },
      t0 + 20,
    );
    expect(r1.accepted).toBe(true);
    expect(r1.status).toBe("ready");
    expect(r1.receipt?.kind).toBe("complete_bundle");

    // Failed application commit must NOT issue application_delivery receipt
    const failedDelivery = await inbox2.deliverBundle(
      "b-1",
      "worker-1",
      async () => {
        throw new Error("DB transient failure");
      },
      t0 + 30,
    );
    expect(failedDelivery.delivered).toBe(false);
    expect(
      inbox2.getBundle("b-1")?.receipts.some((r) => r.kind === "application_delivery"),
    ).toBe(false);

    // Retry succeeds and commits receipt
    let appliedCount = 0;
    const okDelivery = await inbox2.deliverBundle(
      "b-1",
      "worker-2",
      async (payloadB64) => {
        expect(Buffer.from(payloadB64, "base64").toString("utf8")).toBe(
          "HelloWorld!",
        );
        appliedCount++;
      },
      t0 + 40,
    );
    expect(okDelivery.delivered).toBe(true);
    expect(okDelivery.receipt?.kind).toBe("application_delivery");
    expect(appliedCount).toBe(1);

    // Duplicate delivery is idempotent and does not re-apply
    const dupDelivery = await inbox2.deliverBundle(
      "b-1",
      "worker-3",
      async () => {
        appliedCount++;
      },
      t0 + 50,
    );
    expect(dupDelivery.delivered).toBe(true);
    expect(dupDelivery.alreadyDelivered).toBe(true);
    expect(appliedCount).toBe(1);
  });

  it("rejects conflicting fragments and oversized payloads", () => {
    const inbox = new DTNBundlesInbox({ maxTotalPayloadBytes: 10 });
    const t0 = 100_000;

    expect(
      inbox.ingestFragment(
        {
          logicalBundleId: "big",
          source: "a",
          destination: "b",
          fragmentOffset: 0,
          totalPayloadLength: 100,
          payloadBase64: Buffer.from("abc").toString("base64"),
          creationTimestamp: t0,
          lifetimeMs: 60_000,
        },
        t0,
      ).accepted,
    ).toBe(false);

    inbox.ingestFragment(
      {
        logicalBundleId: "b-conflict",
        source: "a",
        destination: "b",
        fragmentOffset: 0,
        totalPayloadLength: 6,
        payloadBase64: Buffer.from("abc").toString("base64"),
        creationTimestamp: t0,
        lifetimeMs: 60_000,
      },
      t0,
    );

    const conflict = inbox.ingestFragment(
      {
        logicalBundleId: "b-conflict",
        source: "a",
        destination: "b",
        fragmentOffset: 0,
        totalPayloadLength: 6,
        payloadBase64: Buffer.from("xyz").toString("base64"),
        creationTimestamp: t0,
        lifetimeMs: 60_000,
      },
      t0 + 1,
    );
    expect(conflict.accepted).toBe(false);
    expect(conflict.error).toContain("Conflicting");
  });
});
