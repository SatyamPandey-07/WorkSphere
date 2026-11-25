export interface HLCState {
  pt: number;
  lc: number;
  nodeId: string;
}

export function compareHLC(a: HLCState, b: HLCState): number {
  if (a.pt !== b.pt) return a.pt < b.pt ? -1 : 1;
  if (a.lc !== b.lc) return a.lc < b.lc ? -1 : 1;
  if (a.nodeId === b.nodeId) return 0;
  return a.nodeId < b.nodeId ? -1 : 1;
}

export function serializeHLC(state: HLCState): string {
  return `${state.pt}:${state.lc}:${state.nodeId}`;
}

export function parseHLC(encoded: string): HLCState {
  const parts = encoded.split(':');
  if (parts.length < 3) {
    throw new Error(`Invalid HLC encoding: ${encoded}`);
  }
  const pt = Number(parts[0]);
  const lc = Number(parts[1]);
  const nodeId = parts.slice(2).join(':');
  if (!Number.isFinite(pt) || !Number.isFinite(lc) || !nodeId) {
    throw new Error(`Malformed HLC fields: ${encoded}`);
  }
  return { pt, lc, nodeId };
}

export class HybridLogicalClock {
  private state: HLCState;

  constructor(
    private readonly nodeId: string,
    initial?: Partial<HLCState>
  ) {
    this.state = {
      pt: initial?.pt ?? 0,
      lc: initial?.lc ?? 0,
      nodeId,
    };
  }

  now(): HLCState {
    return { ...this.state };
  }

  tick(physicalNowMs = Date.now()): HLCState {
    const prev = this.state;
    const nextPt = Math.max(prev.pt, physicalNowMs);
    const nextLc = nextPt === prev.pt ? prev.lc + 1 : 0;

    this.state = {
      pt: nextPt,
      lc: nextLc,
      nodeId: this.nodeId,
    };
    return this.now();
  }

  receive(remote: HLCState, physicalNowMs = Date.now()): HLCState {
    const prev = this.state;
    const nextPt = Math.max(prev.pt, remote.pt, physicalNowMs);

    let nextLc = 0;
    if (nextPt === prev.pt && nextPt === remote.pt) {
      nextLc = Math.max(prev.lc, remote.lc) + 1;
    } else if (nextPt === prev.pt) {
      nextLc = prev.lc + 1;
    } else if (nextPt === remote.pt) {
      nextLc = remote.lc + 1;
    } else {
      nextLc = 0;
    }

    this.state = {
      pt: nextPt,
      lc: nextLc,
      nodeId: this.nodeId,
    };
    return this.now();
  }

  shouldApplyUpdate(incoming: HLCState, currentApplied: HLCState | null): boolean {
    if (!currentApplied) return true;
    return compareHLC(incoming, currentApplied) > 0;
  }
}