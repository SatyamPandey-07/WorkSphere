/**
 * Tests for batch favorites offline save operations.
 */

interface FavoriteAction {
  id?: number;
  venueId: string;
  action: "ADD" | "REMOVE";
  timestamp: number;
}

function deduplicateActions(actions: FavoriteAction[]): FavoriteAction[] {
  const seen = new Map<string, FavoriteAction>();
  for (const a of actions) {
    seen.set(a.venueId, a); // last action for each venue wins
  }
  return [...seen.values()];
}

function filterPendingAdds(actions: FavoriteAction[]): FavoriteAction[] {
  return actions.filter((a) => a.action === "ADD");
}

describe("Venue favorites batch operations", () => {
  const actions: FavoriteAction[] = [
    { venueId: "v1", action: "ADD",    timestamp: 1000 },
    { venueId: "v2", action: "ADD",    timestamp: 2000 },
    { venueId: "v1", action: "REMOVE", timestamp: 3000 }, // overrides ADD
  ];

  it("deduplicateActions keeps last action per venue", () => {
    const result = deduplicateActions(actions);
    const v1 = result.find((a) => a.venueId === "v1")!;
    expect(v1.action).toBe("REMOVE"); // last action wins
  });

  it("deduplicateActions preserves unique venues", () => {
    const result = deduplicateActions(actions);
    expect(result.length).toBe(2);
  });

  it("filterPendingAdds returns only ADD actions", () => {
    const adds = filterPendingAdds(actions);
    expect(adds.every((a) => a.action === "ADD")).toBe(true);
  });

  it("filterPendingAdds excludes REMOVE actions", () => {
    const adds = filterPendingAdds(actions);
    expect(adds.some((a) => a.action === "REMOVE")).toBe(false);
  });

  it("empty actions produce empty deduplicated result", () => {
    expect(deduplicateActions([])).toHaveLength(0);
  });

  it("single ADD action passes through unchanged", () => {
    const single = [{ venueId: "x", action: "ADD" as const, timestamp: 1 }];
    expect(deduplicateActions(single)).toHaveLength(1);
  });
});
