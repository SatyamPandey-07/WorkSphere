/**
 * CausalVectorClockEngine.ts
 * Enterprise-grade distributed causal consistency ordering engine.
 * Implements vector clock arithmetic, strict causal message buffering and cascade delivery,
 * dotted version vectors, and stability horizon matrix clock pruning.
 */

export type CausalOrder = 'HAPPENED_BEFORE' | 'HAPPENED_AFTER' | 'CONCURRENT' | 'IDENTICAL';

export type VectorClockMap = Record<string, number>;

export interface CausalMessage<TPayload = unknown> {
  id: string;
  senderId: string;
  vectorClock: VectorClockMap;
  payload: TPayload;
  timestamp: number;
}

export interface Dot {
  nodeId: string;
  counter: number;
}

export interface StabilityHorizon {
  horizonClock: VectorClockMap;
  lastUpdated: number;
}

export class CausalVectorClockEngine<TPayload = unknown> {
  private readonly nodeId: string;
  private localClock: VectorClockMap = {};
  private bufferedQueue: CausalMessage<TPayload>[] = [];
  private activePeers: Set<string> = new Set();

  // Matrix clock: matrix[i][j] = what node 'nodeId' knows that node 'i' knows about node 'j'
  private peerClocks: Map<string, VectorClockMap> = new Map();

  // Delivery listener callback
  private onDeliverCallback?: (message: CausalMessage<TPayload>) => void;

  constructor(nodeId: string, initialClock: VectorClockMap = {}) {
    this.nodeId = nodeId;
    this.localClock = { ...initialClock };
    if (!this.localClock[this.nodeId]) {
      this.localClock[this.nodeId] = 0;
    }
    this.activePeers.add(this.nodeId);
    this.peerClocks.set(this.nodeId, { ...this.localClock });
  }

  // --- Clock Access & Local Mutation ---

  public getNodeId(): string {
    return this.nodeId;
  }

  public getLocalClock(): VectorClockMap {
    return { ...this.localClock };
  }

  /**
   * Registers a local event mutation, incrementing the local node's counter
   * and returning a new CausalMessage with the updated clock.
   */
  public createLocalEvent(id: string, payload: TPayload): CausalMessage<TPayload> {
    this.localClock[this.nodeId] = (this.localClock[this.nodeId] || 0) + 1;
    this.peerClocks.set(this.nodeId, { ...this.localClock });

    return {
      id,
      senderId: this.nodeId,
      vectorClock: { ...this.localClock },
      payload,
      timestamp: Date.now(),
    };
  }

  // --- Static Causal Comparison ---

  /**
   * Compares two vector clocks to determine their partial order:
   * HAPPENED_BEFORE, HAPPENED_AFTER, CONCURRENT, or IDENTICAL.
   */
  public static compare(a: VectorClockMap, b: VectorClockMap): CausalOrder {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

    let hasLess = false;
    let hasGreater = false;

    for (const key of allKeys) {
      const valA = a[key] || 0;
      const valB = b[key] || 0;

      if (valA < valB) {
        hasLess = true;
      } else if (valA > valB) {
        hasGreater = true;
      }
    }

    if (!hasLess && !hasGreater) {
      return 'IDENTICAL';
    }
    if (hasLess && !hasGreater) {
      return 'HAPPENED_BEFORE';
    }
    if (hasGreater && !hasLess) {
      return 'HAPPENED_AFTER';
    }
    return 'CONCURRENT';
  }

  /**
   * Merges two vector clocks by computing component-wise maximums.
   */
  public static merge(a: VectorClockMap, b: VectorClockMap): VectorClockMap {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const merged: VectorClockMap = {};

    for (const key of allKeys) {
      merged[key] = Math.max(a[key] || 0, b[key] || 0);
    }

    return merged;
  }

  // --- Causal Message Delivery & Buffering ---

  /**
   * Receives an incoming remote causal message.
   * If the message's causal dependencies are fulfilled, delivers it immediately
   * and checks the buffer to trigger any cascading deliveries.
   * Otherwise, holds the message in the buffer until missing predecessors arrive.
   *
   * @returns List of all newly delivered messages in strict causal order.
   */
  public receive(message: CausalMessage<TPayload>): CausalMessage<TPayload>[] {
    const sender = message.senderId;
    this.activePeers.add(sender);

    // If already delivered or duplicate
    const senderExpected = (this.localClock[sender] || 0) + 1;
    const msgSenderClock = message.vectorClock[sender] || 0;

    if (msgSenderClock < senderExpected) {
      // Stale or duplicate message, ignore
      return [];
    }

    // Add to incoming queue
    this.bufferedQueue.push(message);

    // Attempt cascade delivery
    const delivered: CausalMessage<TPayload>[] = [];
    let progress = true;

    while (progress) {
      progress = false;

      for (let i = 0; i < this.bufferedQueue.length; i++) {
        const candidate = this.bufferedQueue[i];
        if (this.canDeliver(candidate)) {
          // Remove from buffer
          this.bufferedQueue.splice(i, 1);

          // Deliver
          this.applyDelivery(candidate);
          delivered.push(candidate);

          if (this.onDeliverCallback) {
            this.onDeliverCallback(candidate);
          }

          progress = true;
          break; // Restart scan to respect new causal state
        }
      }
    }

    return delivered;
  }

  /**
   * Evaluates the Birman-Schiper-Stephenson causal delivery condition:
   * 1. candidate.clock[sender] === localClock[sender] + 1
   * 2. for all other nodes k != sender, candidate.clock[k] <= localClock[k]
   */
  private canDeliver(candidate: CausalMessage<TPayload>): boolean {
    const sender = candidate.senderId;
    const senderClock = candidate.vectorClock[sender] || 0;
    const expectedSenderClock = (this.localClock[sender] || 0) + 1;

    // Must be the immediate next event from sender
    if (senderClock !== expectedSenderClock) {
      return false;
    }

    // All other causal dependencies must be already satisfied locally
    for (const [node, clockVal] of Object.entries(candidate.vectorClock)) {
      if (node === sender) continue;
      const localVal = this.localClock[node] || 0;
      if (clockVal > localVal) {
        return false;
      }
    }

    return true;
  }

  private applyDelivery(candidate: CausalMessage<TPayload>): void {
    const sender = candidate.senderId;
    // Update local clock with sender's clock
    this.localClock[sender] = candidate.vectorClock[sender];

    // Update peer matrix clock
    this.peerClocks.set(sender, { ...candidate.vectorClock });
  }

  // --- Buffer Inspection & Management ---

  public getBufferedCount(): number {
    return this.bufferedQueue.length;
  }

  public getBufferedMessages(): CausalMessage<TPayload>[] {
    return [...this.bufferedQueue];
  }

  public onDeliver(callback: (message: CausalMessage<TPayload>) => void): void {
    this.onDeliverCallback = callback;
  }

  // --- Stability Horizon & Matrix Clock Garbage Collection ---

  /**
   * Computes the stability horizon across all known active peers.
   * Any event whose vector clock is component-wise less than or equal to the stability horizon
   * is guaranteed to have been delivered to all active peers, making it safe to prune.
   */
  public computeStabilityHorizon(): StabilityHorizon {
    if (this.peerClocks.size === 0) {
      return { horizonClock: { ...this.localClock }, lastUpdated: Date.now() };
    }

    const allNodes = Object.keys(this.localClock);
    const horizonClock: VectorClockMap = {};

    for (const node of allNodes) {
      let minVal = Infinity;
      for (const peer of this.activePeers) {
        const peerClock = this.peerClocks.get(peer);
        const val = peerClock ? peerClock[node] || 0 : 0;
        if (val < minVal) {
          minVal = val;
        }
      }
      horizonClock[node] = minVal === Infinity ? 0 : minVal;
    }

    return {
      horizonClock,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Prunes inactive or departed peers from the tracking state.
   */
  public removePeer(peerId: string): void {
    if (peerId === this.nodeId) return;
    this.activePeers.delete(peerId);
    this.peerClocks.delete(peerId);
  }

  public addPeer(peerId: string): void {
    this.activePeers.add(peerId);
  }
}
