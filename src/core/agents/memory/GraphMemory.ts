/**
 * GraphMemory.ts
 * Implements the directed property graph structure to store entities (Venues, Users, Features) 
 * and relationships, enabling persistent mapping of user preferences and venue rejections.
 */

export type EntityType = 'USER' | 'VENUE' | 'FEATURE' | 'CONVERSATION';

export interface GraphNode {
  id: string;
  type: EntityType;
  properties: Record<string, string | number | boolean>;
  createdAt: number;
  lastReinforcedAt?: number;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  relationship: string; // e.g., 'PREFERS', 'REJECTED', 'HAS_FEATURE', 'VISITED'
  weight: number;
  properties: Record<string, string | number | boolean>;
  createdAt: number;
}

export interface GraphMemoryOptions {
  decayTimeConstantMs?: number;
  pruneIntervalMs?: number;
  pruneThreshold?: number;
  maxReferencesForPruning?: number;
}

const DEFAULT_DECAY_TIME_CONSTANT_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRUNE_THRESHOLD = 0.05;
const DEFAULT_MAX_REFERENCES_FOR_PRUNING = 1;

export class GraphMemory {
  private nodes: Map<string, GraphNode>;
  private edges: Map<string, GraphEdge[]>; // Adjacency list: sourceId -> edges
  private entityIndex: Map<string, string>; // entityKey -> canonicalNodeId
  private idAliases: Map<string, string>; // aliasId -> canonicalNodeId
  private locks: Set<string>;
  private readonly decayTimeConstantMs: number;
  private readonly pruneThreshold: number;
  private readonly maxReferencesForPruning: number;
  private readonly pruningTimer?: ReturnType<typeof setInterval>;

  constructor(options: GraphMemoryOptions = {}) {
    const decayTimeConstantMs = options.decayTimeConstantMs ?? DEFAULT_DECAY_TIME_CONSTANT_MS;
    const pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
    const pruneThreshold = options.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD;
    const maxReferencesForPruning = options.maxReferencesForPruning ?? DEFAULT_MAX_REFERENCES_FOR_PRUNING;

    if (decayTimeConstantMs <= 0 || !Number.isFinite(decayTimeConstantMs)) {
      throw new RangeError('decayTimeConstantMs must be a finite positive number.');
    }
    if (pruneIntervalMs < 0 || !Number.isFinite(pruneIntervalMs)) {
      throw new RangeError('pruneIntervalMs must be a finite non-negative number.');
    }
    if (pruneThreshold < 0 || pruneThreshold > 1 || !Number.isFinite(pruneThreshold)) {
      throw new RangeError('pruneThreshold must be between 0 and 1.');
    }
    if (!Number.isInteger(maxReferencesForPruning) || maxReferencesForPruning < 0) {
      throw new RangeError('maxReferencesForPruning must be a non-negative integer.');
    }

    this.nodes = new Map();
    this.edges = new Map();
    this.entityIndex = new Map();
    this.idAliases = new Map();
    this.locks = new Set();
    this.decayTimeConstantMs = decayTimeConstantMs;
    this.pruneThreshold = pruneThreshold;
    this.maxReferencesForPruning = maxReferencesForPruning;

    if (pruneIntervalMs > 0) {
      this.pruningTimer = setInterval(() => this.pruneStaleEntities(), pruneIntervalMs);
      this.pruningTimer.unref?.();
    }
  }

  public resolveNodeId(id: string): string {
    return this.idAliases.get(id) ?? id;
  }

  public getEntityKey(node: GraphNode): string {
    const name =
      (node.properties?.name ||
        node.properties?.label ||
        node.properties?.entityName ||
        node.properties?.title) as string | undefined;

    if (name && typeof name === 'string' && name.trim().length > 0) {
      return `${node.type}:${name.trim().toLowerCase()}`;
    }
    return `${node.type}:${node.id.trim().toLowerCase()}`;
  }

  /**
   * Acquires an idempotent insertion lock for an entity key.
   */
  public async acquireLock(key: string, timeoutMs = 5000): Promise<() => void> {
    const start = Date.now();
    while (this.locks.has(key)) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Insertion lock timeout for key: ${key}`);
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    this.locks.add(key);
    return () => {
      this.locks.delete(key);
    };
  }

  /**
   * Executes an asynchronous task protected by an insertion lock.
   */
  public async withLock<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const unlock = await this.acquireLock(key);
    try {
      return await task();
    } finally {
      unlock();
    }
  }

  public isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  public addNode(node: GraphNode): GraphNode {
    const now = Date.now();
    const resolvedId = this.resolveNodeId(node.id);
    const entityKey = this.getEntityKey(node);

    // Look up canonical node by entity key or resolved ID
    const canonicalId =
      this.entityIndex.get(entityKey) ??
      (this.nodes.has(resolvedId) ? resolvedId : undefined);

    if (canonicalId && this.nodes.has(canonicalId)) {
      const existing = this.nodes.get(canonicalId)!;
      const updatedNode: GraphNode = {
        ...existing,
        ...node,
        id: canonicalId, // Maintain canonical ID
        properties: {
          ...existing.properties,
          ...node.properties,
        },
        createdAt: existing.createdAt ?? node.createdAt ?? now,
        lastReinforcedAt: now,
      };

      this.nodes.set(canonicalId, updatedNode);
      if (node.id !== canonicalId) {
        this.idAliases.set(node.id, canonicalId);
      }
      if (!this.edges.has(canonicalId)) {
        this.edges.set(canonicalId, []);
      }
      return updatedNode;
    }

    // New node insertion
    const newNode: GraphNode = {
      ...node,
      createdAt: node.createdAt ?? now,
      lastReinforcedAt: now,
    };

    this.nodes.set(node.id, newNode);
    this.entityIndex.set(entityKey, node.id);
    if (!this.edges.has(node.id)) {
      this.edges.set(node.id, []);
    }
    return newNode;
  }

  public addEdge(edge: GraphEdge): void {
    const sourceId = this.resolveNodeId(edge.sourceId);
    const targetId = this.resolveNodeId(edge.targetId);

    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) {
      throw new Error('Both source and target nodes must exist before adding an edge.');
    }
    
    const now = Date.now();
    for (const nodeId of [sourceId, targetId]) {
      const node = this.nodes.get(nodeId)!;
      this.nodes.set(nodeId, { ...node, lastReinforcedAt: now });
    }

    this.upsertEdge({ ...edge, sourceId, targetId, createdAt: now });
  }

  private upsertEdge(edge: GraphEdge): void {
    const newEdge = { ...edge };
    const sourceEdges = this.edges.get(edge.sourceId) || [];
    
    // Update existing edge if relationship and target match, otherwise push new
    const existingIndex = sourceEdges.findIndex(
      e => e.targetId === edge.targetId && e.relationship === edge.relationship
    );
    
    if (existingIndex !== -1) {
      sourceEdges[existingIndex] = newEdge;
    } else {
      sourceEdges.push(newEdge);
    }
    
    this.edges.set(edge.sourceId, sourceEdges);
  }

  private decayMultiplier(timestamp: number, now: number): number {
    return Math.exp(-Math.max(0, now - timestamp) / this.decayTimeConstantMs);
  }

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(this.resolveNodeId(id));
  }

  public getNodeRelevance(id: string, now = Date.now()): number {
    const resolvedId = this.resolveNodeId(id);
    const node = this.nodes.get(resolvedId);
    return node
      ? this.decayMultiplier(node.lastReinforcedAt ?? node.createdAt, now)
      : 0;
  }

  public getConnectedNodes(sourceId: string, relationship?: string): GraphNode[] {
    const resolvedSourceId = this.resolveNodeId(sourceId);
    const sourceEdges = this.edges.get(resolvedSourceId) || [];
    const filteredEdges = relationship 
      ? sourceEdges.filter(e => e.relationship === relationship)
      : sourceEdges;

    return filteredEdges
      .map(e => this.nodes.get(this.resolveNodeId(e.targetId)))
      .filter((node): node is GraphNode => node !== undefined);
  }

  public getUserPreferences(userId: string): { featureId: string; weight: number }[] {
    const preferredFeatures = this.getConnectedNodes(userId, 'PREFERS');
    const sourceEdges = this.edges.get(userId) ?? [];
    const now = Date.now();
    return preferredFeatures.map(node => {
      const preference = sourceEdges.find(edge => edge.targetId === node.id && edge.relationship === 'PREFERS');
      return {
        featureId: node.id,
        weight: (preference?.weight ?? 1)
          * this.decayMultiplier(preference?.createdAt ?? now, now)
      };
    });
  }

  public getRejectedVenues(userId: string): string[] {
    return this.getConnectedNodes(userId, 'REJECTED').map(node => node.id);
  }

  public exportGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const allEdges: GraphEdge[] = [];
    this.edges.forEach(edgeList => allEdges.push(...edgeList));
    
    return {
      nodes: Array.from(this.nodes.values()),
      edges: allEdges
    };
  }

  public pruneStaleEntities(now = Date.now()): number {
    const referenceCounts = new Map<string, number>();
    for (const [sourceId, sourceEdges] of this.edges) {
      for (const edge of sourceEdges) {
        referenceCounts.set(sourceId, (referenceCounts.get(sourceId) ?? 0) + 1);
        referenceCounts.set(edge.targetId, (referenceCounts.get(edge.targetId) ?? 0) + 1);
      }
    }

    const staleNodeIds = new Set<string>();
    for (const node of this.nodes.values()) {
      if (
        node.type !== 'USER' &&
        (referenceCounts.get(node.id) ?? 0) <= this.maxReferencesForPruning &&
        this.getNodeRelevance(node.id, now) < this.pruneThreshold
      ) {
        staleNodeIds.add(node.id);
      }
    }

    for (const nodeId of staleNodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) {
        this.entityIndex.delete(this.getEntityKey(node));
      }
      this.nodes.delete(nodeId);
      this.edges.delete(nodeId);
    }
    if (staleNodeIds.size > 0) {
      for (const [sourceId, sourceEdges] of this.edges) {
        this.edges.set(sourceId, sourceEdges.filter(edge => !staleNodeIds.has(edge.targetId)));
      }
    }

    return staleNodeIds.size;
  }

  public dispose(): void {
    if (this.pruningTimer) {
      clearInterval(this.pruningTimer);
    }
  }

  public importGraph(data: { nodes: GraphNode[]; edges: GraphEdge[] }): void {
    this.nodes.clear();
    this.edges.clear();
    this.entityIndex.clear();
    this.idAliases.clear();
    
    data.nodes.forEach(node => {
      this.addNode(node);
    });
    data.edges.forEach(edge => {
      this.addEdge(edge);
    });
  }
}
