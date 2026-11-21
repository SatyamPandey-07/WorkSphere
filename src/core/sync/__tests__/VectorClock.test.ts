import { VectorClock } from "../VectorClock";
import type { HLCState } from "../HybridLogicalClock";

describe("VectorClock causal ordering", () => {
  it("tracks counters in a Map while exposing a defensive record snapshot", () => {
    const initial = new Map<string, number>([
      ["peer-a", 2],
      ["peer-b", 4],
    ]);
    const clock = new VectorClock("peer-c", initial);

    expect(clock.getClock()).toEqual({
      "peer-a": 2,
      "peer-b": 4,
      "peer-c": 0,
    });

    const snapshot = clock.getClock();
    snapshot["peer-a"] = 99;
    expect(clock.getClock()["peer-a"]).toBe(2);
  });

  it("increments only the local node", () => {
    const clock = new VectorClock("peer-a", { "peer-a": 2, "peer-b": 7 });

    expect(clock.increment()).toEqual({ "peer-a": 3, "peer-b": 7 });
    expect(clock.increment()["peer-a"]).toBe(4);
  });

  it("compares before, after, equal, and concurrent clocks across three peers", () => {
    const peerA = new VectorClock("peer-a", {
      "peer-a": 2,
      "peer-b": 1,
    });
    const peerB = new VectorClock("peer-b", {
      "peer-a": 2,
      "peer-b": 2,
    });
    const peerC = new VectorClock("peer-c", {
      "peer-a": 1,
      "peer-b": 1,
      "peer-c": 1,
    });
    const identical = new VectorClock("peer-x", {
      "peer-a": 2,
      "peer-b": 1,
    });

    expect(peerA.compareTo(peerB.getClock())).toBe("BEFORE");
    expect(peerB.compareTo(peerA.getClock())).toBe("AFTER");
    expect(peerA.compareTo(identical.getClock())).toBe("EQUAL");
    expect(peerA.compareTo(peerC.getClock())).toBe("CONCURRENT");
    expect(peerA.isConcurrentWith(peerC.getClock())).toBe(true);
    expect(peerA.isConcurrentWith(peerB.getClock())).toBe(false);
  });

  it("treats missing node entries as zero", () => {
    const empty = new VectorClock("peer-a");
    const remote = new VectorClock("peer-b", { "peer-b": 1 });

    expect(empty.compareTo({})).toBe("EQUAL");
    expect(empty.compareTo(remote.getClock())).toBe("BEFORE");
    expect(remote.compareTo(empty.getClock())).toBe("AFTER");
  });

  it("reports strict causal descent and excludes equal or concurrent clocks", () => {
    const ancestor = new VectorClock("peer-a", {
      "peer-a": 2,
      "peer-b": 1,
    });
    const descendant = new VectorClock("peer-b", {
      "peer-a": 2,
      "peer-b": 3,
    });
    const equal = new VectorClock("peer-x", {
      "peer-a": 2,
      "peer-b": 1,
    });
    const concurrent = new VectorClock("peer-c", {
      "peer-a": 1,
      "peer-b": 1,
      "peer-c": 1,
    });

    expect(descendant.descendsFrom(ancestor.getClock())).toBe(true);
    expect(ancestor.descendsFrom(descendant.getClock())).toBe(false);
    expect(equal.descendsFrom(ancestor.getClock())).toBe(false);
    expect(concurrent.descendsFrom(ancestor.getClock())).toBe(false);
  });

  it("merges component-wise maxima and advances the local receive counter", () => {
    const clock = new VectorClock("peer-a", {
      "peer-a": 2,
      "peer-b": 1,
    });
    const incoming = new Map<string, number>([
      ["peer-b", 4],
      ["peer-c", 3],
    ]);

    expect(clock.merge(incoming)).toEqual({
      "peer-a": 3,
      "peer-b": 4,
      "peer-c": 3,
    });
  });

  it("does not let HLC order override a known causal relationship", () => {
    const local = new VectorClock("peer-a", { "peer-a": 3, "peer-b": 1 });
    const remoteClock = { "peer-a": 2, "peer-b": 1 };
    const localHlc: HLCState = { pt: 900, lc: 0, nodeId: "peer-a" };
    const remoteHlc: HLCState = { pt: 100, lc: 0, nodeId: "peer-b" };

    expect(local.compareWithHLC(remoteClock, localHlc, remoteHlc)).toEqual({
      relation: "AFTER",
      winner: "local",
      decidedBy: "causality",
    });
  });

  it("uses HLC timestamps and node IDs to resolve concurrent versions deterministically", () => {
    const local = new VectorClock("peer-a", { "peer-a": 2 });
    const remoteClock = { "peer-b": 2 };
    const localHlc: HLCState = { pt: 1000, lc: 1, nodeId: "peer-a" };
    const remoteHlc: HLCState = { pt: 1000, lc: 2, nodeId: "peer-b" };

    expect(local.compareWithHLC(remoteClock, localHlc, remoteHlc)).toEqual({
      relation: "CONCURRENT",
      winner: "remote",
      decidedBy: "hlc",
    });
    expect(local.compareWithHLC(remoteClock, remoteHlc, remoteHlc).winner).toBe(
      "tie",
    );
  });

  it("rejects invalid node identifiers and invalid counter values", () => {
    expect(() => new VectorClock("")).toThrow("non-empty nodeId");
    expect(() => new VectorClock("peer-a", { "peer-b": -1 })).toThrow(
      "non-negative safe integer",
    );
    expect(() => new VectorClock("peer-a", { "peer-b": Number.NaN })).toThrow(
      "non-negative safe integer",
    );
  });

  it("rejects malformed incoming clocks without mutating local state", () => {
    const clock = new VectorClock("peer-a", { "peer-a": 1 });
    expect(() => clock.merge({ "peer-b": 1.5 })).toThrow(
      "non-negative safe integer",
    );
    expect(clock.getClock()).toEqual({ "peer-a": 1 });
  });
});
