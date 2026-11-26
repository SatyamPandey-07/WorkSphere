import { LamportTimestampResolver, type MutationPayload } from "../LamportTimestampResolver";

describe("LamportTimestampResolver causal/HLC merge", () => {
  const mutation = (
    id: string,
    nodeId: string,
    clock: Record<string, number>,
    pt: number,
    data: string,
    lamportTs = pt,
  ): MutationPayload<string> => ({
    id,
    entityId: "note-1",
    data,
    clock,
    lamportTs,
    hlc: { pt, lc: 0, nodeId },
    nodeId,
  });

  it("prefers a causally newer note even when its HLC is older", () => {
    const older = mutation("a-1", "peer-a", { "peer-a": 2 }, 900, "older");
    const newer = mutation(
      "b-1",
      "peer-b",
      { "peer-a": 2, "peer-b": 1 },
      100,
      "newer",
    );

    expect(LamportTimestampResolver.resolveConflict(older, newer)).toBe(newer);
    expect(LamportTimestampResolver.resolveConflict(newer, older)).toBe(newer);
  });

  it("uses HLC ordering for concurrent edits", () => {
    const peerA = mutation("a-1", "peer-a", { "peer-a": 1 }, 1000, "A", 10);
    const peerB = mutation("b-1", "peer-b", { "peer-b": 1 }, 2000, "B", 1);

    expect(LamportTimestampResolver.resolveConflict(peerA, peerB)).toBe(peerB);
  });

  it("falls back to legacy Lamport time and node ID for old queued mutations", () => {
    const peerA: MutationPayload<string> = {
      id: "a-1",
      entityId: "note-1",
      data: "A",
      clock: { "peer-a": 1 },
      lamportTs: 10,
      nodeId: "peer-a",
    };
    const peerB: MutationPayload<string> = {
      id: "b-1",
      entityId: "note-1",
      data: "B",
      clock: { "peer-b": 1 },
      lamportTs: 10,
      nodeId: "peer-b",
    };

    expect(LamportTimestampResolver.resolveConflict(peerA, peerB)).toBe(peerB);
  });

  it("keeps the causally newest state when replaying multi-peer mutations", () => {
    const older = mutation("a-1", "peer-a", { "peer-a": 1 }, 300, "old");
    const newer = mutation(
      "b-1",
      "peer-b",
      { "peer-a": 1, "peer-b": 1 },
      100,
      "new",
    );

    const result = LamportTimestampResolver.replayMutations(
      {},
      {},
      [older, newer],
      "server",
    );

    expect(result.state["note-1"]).toBe("new");
    expect(result.clock["peer-a"]).toBeGreaterThanOrEqual(1);
    expect(result.clock["peer-b"]).toBeGreaterThanOrEqual(1);
  });

  it("preserves falsy entity values while replaying updates", () => {
    const emptyValue = mutation("a-1", "peer-a", { "peer-a": 1 }, 100, "");
    const update = mutation(
      "b-1",
      "peer-b",
      { "peer-a": 1, "peer-b": 1 },
      200,
      "recovered",
    );

    const result = LamportTimestampResolver.replayMutations(
      { "note-1": "" },
      { "peer-a": 1 },
      [update],
      "server",
    );

    expect(result.state["note-1"]).toBe("recovered");
    expect(emptyValue.data).toBe("");
  });
});
