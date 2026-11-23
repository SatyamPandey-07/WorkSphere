/**
 * OfflineMutationQueue.ts
 *
 * Causal dependency buffering and vector clock monotonicity engine for offline mutations.
 * Resolves vector clock forks caused by out-of-order network arrival of disconnected mutations (#9636).
 *
 * Enforces the Birman-Schiper-Stephenson causal delivery condition:
 * 1. Immediate successor: mutation.clock[clientId] === localClock[clientId] + 1
 * 2. Predecessor dependencies: for all other nodes k !== clientId, mutation.clock[k] <= localClock[k]
 *
 * Out-of-order or orphan mutations are buffered in a pending dependency pool and
 * automatically cascade-applied in strict causal sequence when their predecessors arrive.
 */

export interface OfflineMutation<TPayload = unknown> {
  id: string;
  clientId: string;
  vectorClock: Record<string, number>;
  parentClock?: Record<string, number>;
  payload: TPayload;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export type MutationStatus = "APPLIED" | "BUFFERED" | "DUPLICATE" | "REJECTED";

export interface MutationEnqueueResult<TPayload = unknown> {
  status: MutationStatus;
  mutationId: string;
  appliedMutations: OfflineMutation<TPayload>[];
  bufferedCount: number;
  currentClock: Record<string, number>;
  reason?: string;
}

export interface OfflineMutationQueueConfig {
  nodeId?: string;
  initialClock?: Record<string, number>;
  maxBufferSize?: number;
}

export class OfflineMutationQueue<TPayload = unknown> {
  private readonly nodeId: string;
  private localClock: Record<string, number> = {};
  private pendingPool: Map<string, OfflineMutation<TPayload>> = new Map();
  private appliedIds: Set<string> = new Set();
  private appliedHistory: OfflineMutation<TPayload>[] = [];
  private readonly maxBufferSize: number;

  private onApplyCallback?: (mutation: OfflineMutation<TPayload>) => void;
  private onBufferCallback?: (mutation: OfflineMutation<TPayload>) => void;

  constructor(config: OfflineMutationQueueConfig = {}) {
    this.nodeId = config.nodeId || "server";
    this.maxBufferSize = config.maxBufferSize || 5000;

    if (config.initialClock) {
      for (const [node, counter] of Object.entries(config.initialClock)) {
        this.validateCounter(node, counter, "initialClock");
        this.localClock[node] = counter;
      }
    }

    if (this.localClock[this.nodeId] === undefined) {
      this.localClock[this.nodeId] = 0;
    }
  }

  // --- Clock & State Access ---

  public getNodeId(): string {
    return this.nodeId;
  }

  public getLocalClock(): Record<string, number> {
    return { ...this.localClock };
  }

  public getPendingCount(): number {
    return this.pendingPool.size;
  }

  public getPendingMutations(): OfflineMutation<TPayload>[] {
    return Array.from(this.pendingPool.values());
  }

  public getAppliedHistory(): OfflineMutation<TPayload>[] {
    return [...this.appliedHistory];
  }

  public isApplied(mutationId: string): boolean {
    return this.appliedIds.has(mutationId);
  }

  public isPending(mutationId: string): boolean {
    return this.pendingPool.has(mutationId);
  }

  public onApply(
    callback: (mutation: OfflineMutation<TPayload>) => void,
  ): void {
    this.onApplyCallback = callback;
  }

  public onBuffer(
    callback: (mutation: OfflineMutation<TPayload>) => void,
  ): void {
    this.onBufferCallback = callback;
  }

  // --- Mutation Ingestion & Causal Buffering ---

  /**
   * Enqueues an incoming offline mutation.
   *
   * - If already applied or duplicate: returns 'DUPLICATE'.
   * - If causal dependencies are met: applies immediately and cascades any unblocked orphans.
   * - If causal dependencies are missing (orphan mutation): buffers in pending pool.
   */
  public enqueue(
    mutation: OfflineMutation<TPayload>,
  ): MutationEnqueueResult<TPayload> {
    this.validateMutation(mutation);

    // 1. Idempotency / Stale Check
    if (this.appliedIds.has(mutation.id)) {
      return {
        status: "DUPLICATE",
        mutationId: mutation.id,
        appliedMutations: [],
        bufferedCount: this.pendingPool.size,
        currentClock: this.getLocalClock(),
        reason: "Mutation already applied",
      };
    }

    const client = mutation.clientId;
    const clientCounter = mutation.vectorClock[client] || 0;
    const currentLocalCounter = this.localClock[client] || 0;

    // If client's clock is already past or equal to this counter, it is a stale/duplicate message
    if (clientCounter <= currentLocalCounter) {
      return {
        status: "DUPLICATE",
        mutationId: mutation.id,
        appliedMutations: [],
        bufferedCount: this.pendingPool.size,
        currentClock: this.getLocalClock(),
        reason: `Stale mutation: client clock ${clientCounter} <= local clock ${currentLocalCounter}`,
      };
    }

    // 2. Evaluate Causal Readiness
    if (!this.canApply(mutation)) {
      // Buffer in pending dependency pool
      if (this.pendingPool.size >= this.maxBufferSize) {
        throw new Error(
          `OfflineMutationQueue buffer overflow: exceeded maxBufferSize of ${this.maxBufferSize}`,
        );
      }

      this.pendingPool.set(mutation.id, mutation);
      this.onBufferCallback?.(mutation);

      return {
        status: "BUFFERED",
        mutationId: mutation.id,
        appliedMutations: [],
        bufferedCount: this.pendingPool.size,
        currentClock: this.getLocalClock(),
        reason: "Buffered awaiting missing causal predecessor mutations",
      };
    }

    // 3. Apply Ready Mutation & Cascade Unblocked Orphans
    const applied: OfflineMutation<TPayload>[] = [];

    // Apply the primary mutation
    this.applyMutationDirectly(mutation);
    applied.push(mutation);

    // Cascade resolution over pending pool
    let progress = true;
    while (progress) {
      progress = false;

      for (const [id, orphan] of Array.from(this.pendingPool.entries())) {
        if (this.canApply(orphan)) {
          this.pendingPool.delete(id);
          this.applyMutationDirectly(orphan);
          applied.push(orphan);
          progress = true;
          break; // Restart scan to evaluate against the newly advanced vector clock
        }
      }
    }

    return {
      status: "APPLIED",
      mutationId: mutation.id,
      appliedMutations: applied,
      bufferedCount: this.pendingPool.size,
      currentClock: this.getLocalClock(),
    };
  }

  /**
   * Enqueues an ordered or unordered batch of mutations.
   */
  public enqueueBatch(
    mutations: OfflineMutation<TPayload>[],
  ): MutationEnqueueResult<TPayload>[] {
    return mutations.map((m) => this.enqueue(m));
  }

  /**
   * Evaluates the causal predecessor condition:
   * 1. If explicit parentClock is supplied:
   *    All parentClock node values must be <= localClock.
   *    And mutation.vectorClock[clientId] === (localClock[clientId] || 0) + 1.
   * 2. Standard Birman-Schiper-Stephenson condition:
   *    mutation.vectorClock[clientId] === (localClock[clientId] || 0) + 1
   *    AND for all other nodes k !== clientId, mutation.vectorClock[k] <= (localClock[k] || 0).
   */
  public canApply(mutation: OfflineMutation<TPayload>): boolean {
    const client = mutation.clientId;
    const clientClock = mutation.vectorClock[client] || 0;
    const localClientClock = this.localClock[client] || 0;

    // Must be the immediate next counter from this client
    if (clientClock !== localClientClock + 1) {
      return false;
    }

    // If explicit parentClock is provided, check each dependency
    if (mutation.parentClock) {
      for (const [node, parentVal] of Object.entries(mutation.parentClock)) {
        const localVal = this.localClock[node] || 0;
        if (parentVal > localVal) {
          return false;
        }
      }
    }

    // Check all other nodes in the vector clock
    for (const [node, counter] of Object.entries(mutation.vectorClock)) {
      if (node === client) continue;
      const localVal = this.localClock[node] || 0;
      if (counter > localVal) {
        return false;
      }
    }

    return true;
  }

  /**
   * Applies the mutation to the local state and advances the vector clock monotonically.
   */
  private applyMutationDirectly(mutation: OfflineMutation<TPayload>): void {
    const client = mutation.clientId;

    // Advance client counter monotonically
    this.localClock[client] = mutation.vectorClock[client];

    // Component-wise merge for any concurrent peer clocks embedded in vectorClock
    for (const [node, counter] of Object.entries(mutation.vectorClock)) {
      if (
        this.localClock[node] === undefined ||
        counter > this.localClock[node]
      ) {
        this.localClock[node] = counter;
      }
    }

    // Mark as applied
    this.appliedIds.add(mutation.id);
    this.appliedHistory.push(mutation);

    // Trigger callback
    this.onApplyCallback?.(mutation);
  }

  private validateMutation(mutation: OfflineMutation<TPayload>): void {
    if (!mutation || typeof mutation !== "object") {
      throw new TypeError("OfflineMutation must be an object");
    }
    if (
      !mutation.id ||
      typeof mutation.id !== "string" ||
      mutation.id.trim().length === 0
    ) {
      throw new TypeError("OfflineMutation requires a non-empty string id");
    }
    if (
      !mutation.clientId ||
      typeof mutation.clientId !== "string" ||
      mutation.clientId.trim().length === 0
    ) {
      throw new TypeError(
        "OfflineMutation requires a non-empty string clientId",
      );
    }
    if (!mutation.vectorClock || typeof mutation.vectorClock !== "object") {
      throw new TypeError("OfflineMutation requires a vectorClock object");
    }
    if (mutation.vectorClock[mutation.clientId] === undefined) {
      throw new TypeError(
        `OfflineMutation vectorClock must contain clientId "${mutation.clientId}"`,
      );
    }

    for (const [node, counter] of Object.entries(mutation.vectorClock)) {
      this.validateCounter(node, counter, "vectorClock");
    }

    if (mutation.parentClock) {
      for (const [node, counter] of Object.entries(mutation.parentClock)) {
        this.validateCounter(node, counter, "parentClock");
      }
    }
  }

  private validateCounter(node: string, counter: unknown, label: string): void {
    if (typeof node !== "string" || node.trim().length === 0) {
      throw new TypeError(`${label} contains an empty node identifier.`);
    }
    if (
      typeof counter !== "number" ||
      !Number.isSafeInteger(counter) ||
      counter < 0
    ) {
      throw new RangeError(
        `${label} counter for "${node}" must be a non-negative integer.`,
      );
    }
  }

  /**
   * Clears queue state (useful for tests or cache resets).
   */
  public clear(): void {
    this.pendingPool.clear();
    this.appliedIds.clear();
    this.appliedHistory = [];
    this.localClock = { [this.nodeId]: 0 };
  }
}
