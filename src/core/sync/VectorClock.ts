import { compareHLC, type HLCState } from "./HybridLogicalClock";

export type ClockMap = Record<string, number>;
export type VectorClockInput = ClockMap | ReadonlyMap<string, number>;
export type VectorClockRelation = "BEFORE" | "AFTER" | "CONCURRENT" | "EQUAL";

export interface VectorClockMergeDecision {
  /** Partial causal order of this instance relative to the remote clock. */
  relation: VectorClockRelation;
  /** Deterministic winner when selecting one conflicting state. */
  winner: "local" | "remote" | "tie";
  /** Whether causal order or the HLC tie-break selected the winner. */
  decidedBy: "causality" | "hlc" | "none";
}

function readEntries(
  clock: VectorClockInput,
  label: string,
): Array<[string, number]> {
  const entries =
    clock instanceof Map
      ? Array.from(clock.entries())
      : clock && typeof clock === "object" && !Array.isArray(clock)
        ? Object.entries(clock)
        : null;

  if (!entries) {
    throw new TypeError(`${label} must be a clock map or record.`);
  }

  for (const [nodeId, counter] of entries) {
    if (typeof nodeId !== "string" || nodeId.trim().length === 0) {
      throw new TypeError(`${label} contains an empty node identifier.`);
    }
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new RangeError(
        `${label} counter for "${nodeId}" must be a non-negative safe integer.`,
      );
    }
  }

  return entries;
}

/**
 * Tracks per-node logical counters for causal ordering across offline peers.
 *
 * The internal representation is a Map, while getClock() keeps returning a
 * plain record for compatibility with persisted JSON and existing sync callers.
 */
export class VectorClock {
  private readonly clock: Map<string, number>;
  private readonly nodeId: string;

  constructor(nodeId: string, initialClock: VectorClockInput = {}) {
    if (typeof nodeId !== "string" || nodeId.trim().length === 0) {
      throw new TypeError("VectorClock requires a non-empty nodeId.");
    }

    this.nodeId = nodeId;
    this.clock = new Map(readEntries(initialClock, "Initial vector clock"));
    if (!this.clock.has(this.nodeId)) {
      this.clock.set(this.nodeId, 0);
    }
  }

  /** Increments the local node's counter before recording a local mutation. */
  public increment(): ClockMap {
    this.clock.set(this.nodeId, (this.clock.get(this.nodeId) ?? 0) + 1);
    return this.getClock();
  }

  /**
   * Merges a received clock by taking component-wise maxima, then advances the
   * local component to record receipt of the remote state. This preserves the
   * behavior expected by the existing sync worker and API resolver.
   */
  public merge(incomingClock: VectorClockInput): ClockMap {
    for (const [nodeId, incomingCounter] of readEntries(
      incomingClock,
      "Incoming vector clock",
    )) {
      this.clock.set(
        nodeId,
        Math.max(this.clock.get(nodeId) ?? 0, incomingCounter),
      );
    }

    this.clock.set(this.nodeId, (this.clock.get(this.nodeId) ?? 0) + 1);
    return this.getClock();
  }

  /**
   * Returns the partial causal relationship of this clock to another clock.
   * Missing node entries are treated as zero.
   */
  public compareTo(otherClock: VectorClockInput): VectorClockRelation {
    const other = new Map(readEntries(otherClock, "Compared vector clock"));
    const allNodes = new Set([...this.clock.keys(), ...other.keys()]);
    let isLess = false;
    let isGreater = false;

    for (const nodeId of allNodes) {
      const localCounter = this.clock.get(nodeId) ?? 0;
      const remoteCounter = other.get(nodeId) ?? 0;

      if (localCounter < remoteCounter) isLess = true;
      if (localCounter > remoteCounter) isGreater = true;

      if (isLess && isGreater) return "CONCURRENT";
    }

    if (isLess) return "BEFORE";
    if (isGreater) return "AFTER";
    return "EQUAL";
  }

  /** True only when neither clock causally includes the other. */
  public isConcurrentWith(otherClock: VectorClockInput): boolean {
    return this.compareTo(otherClock) === "CONCURRENT";
  }

  /**
   * True when this clock is a strict causal descendant of the supplied clock.
   * Equal clocks are not considered descendants.
   */
  public descendsFrom(ancestorClock: VectorClockInput): boolean {
    return this.compareTo(ancestorClock) === "AFTER";
  }

  /**
   * Compares causality first and uses HLC ordering only when the vectors are
   * concurrent or equal. This creates a deterministic conflict winner without
   * incorrectly treating an HLC timestamp as proof of causal ancestry.
   */
  public compareWithHLC(
    otherClock: VectorClockInput,
    localTimestamp: HLCState,
    remoteTimestamp: HLCState,
  ): VectorClockMergeDecision {
    const relation = this.compareTo(otherClock);

    if (relation === "AFTER") {
      return { relation, winner: "local", decidedBy: "causality" };
    }
    if (relation === "BEFORE") {
      return { relation, winner: "remote", decidedBy: "causality" };
    }

    const timestampOrder = compareHLC(localTimestamp, remoteTimestamp);
    if (timestampOrder > 0) {
      return { relation, winner: "local", decidedBy: "hlc" };
    }
    if (timestampOrder < 0) {
      return { relation, winner: "remote", decidedBy: "hlc" };
    }

    return { relation, winner: "tie", decidedBy: "none" };
  }

  /** Returns a defensive JSON-friendly snapshot of the clock. */
  public getClock(): ClockMap {
    const entries = Array.from(this.clock.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries) as ClockMap;
  }

  public getNodeId(): string {
    return this.nodeId;
  }
}
