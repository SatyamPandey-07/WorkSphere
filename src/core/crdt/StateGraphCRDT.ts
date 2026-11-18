/**
 * State-Based Delta-Mutator Conflict-Free Replicated Graph (CRDT Graph)
 * Implements Add-Wins Observed-Remove (OR-Set) semantics for vertices and edges,
 * deterministic DAG cycle resolution, topological sorting, and bounded deltas.
 */

export interface CRDTElementTag {
  replicaId: string;
  counter: number;
  timestamp: number;
}

export interface VertexRecord<T = Record<string, unknown>> {
  id: string;
  label: string;
  properties: T;
  addTags: CRDTElementTag[];
  removeTags: CRDTElementTag[];
}

export interface EdgeRecord {
  edgeId: string; // "sourceId->targetId"
  sourceId: string;
  targetId: string;
  weight: number;
  addTags: CRDTElementTag[];
  removeTags: CRDTElementTag[];
}

export interface GraphDelta {
  replicaId: string;
  verticesAdded: Array<{ id: string; label: string; properties: Record<string, unknown>; tag: CRDTElementTag }>;
  verticesRemoved: Array<{ id: string; tag: CRDTElementTag }>;
  edgesAdded: Array<{ sourceId: string; targetId: string; weight: number; tag: CRDTElementTag }>;
  edgesRemoved: Array<{ sourceId: string; targetId: string; tag: CRDTElementTag }>;
}

export interface StateGraphConfig {
  replicaId: string;
  enforceAcyclic?: boolean; // Maintain DAG invariant
}

export class StateGraphCRDT {
  public readonly replicaId: string;
  public readonly enforceAcyclic: boolean;

  private counter = 0;
  // id -> VertexRecord
  private vertices: Map<string, VertexRecord> = new Map();
  // edgeId ("u->v") -> EdgeRecord
  private edges: Map<string, EdgeRecord> = new Map();

  constructor(config: StateGraphConfig) {
    this.replicaId = config.replicaId;
    this.enforceAcyclic = config.enforceAcyclic ?? false;
  }

  /**
   * Adds or updates a vertex with Add-Wins semantics.
   */
  public addVertex(
    id: string,
    label: string = '',
    properties: Record<string, unknown> = {}
  ): GraphDelta {
    const tag = this.nextTag();
    let vertex = this.vertices.get(id);

    if (!vertex) {
      vertex = {
        id,
        label,
        properties,
        addTags: [tag],
        removeTags: [],
      };
      this.vertices.set(id, vertex);
    } else {
      vertex.label = label || vertex.label;
      vertex.properties = { ...vertex.properties, ...properties };
      vertex.addTags.push(tag);
    }

    return {
      replicaId: this.replicaId,
      verticesAdded: [{ id, label, properties, tag }],
      verticesRemoved: [],
      edgesAdded: [],
      edgesRemoved: [],
    };
  }

  /**
   * Removes a vertex by moving all observed addTags into removeTags (tombstone).
   */
  public removeVertex(id: string): GraphDelta {
    const vertex = this.vertices.get(id);
    if (!vertex) {
      return this.emptyDelta();
    }

    const removedTags = [...vertex.addTags];
    vertex.removeTags.push(...removedTags);

    // Also remove incident edges
    const removedEdges: Array<{ sourceId: string; targetId: string; tag: CRDTElementTag }> = [];
    for (const edge of this.edges.values()) {
      if (edge.sourceId === id || edge.targetId === id) {
        const edgeTags = [...edge.addTags];
        edge.removeTags.push(...edgeTags);
        for (const t of edgeTags) {
          removedEdges.push({ sourceId: edge.sourceId, targetId: edge.targetId, tag: t });
        }
      }
    }

    return {
      replicaId: this.replicaId,
      verticesAdded: [],
      verticesRemoved: removedTags.map((t) => ({ id, tag: t })),
      edgesAdded: [],
      edgesRemoved: removedEdges,
    };
  }

  /**
   * Adds a directed edge between two active vertices.
   */
  public addEdge(
    sourceId: string,
    targetId: string,
    weight: number = 1.0
  ): { delta: GraphDelta; success: boolean; cycleRejected?: boolean } {
    if (!this.hasVertex(sourceId) || !this.hasVertex(targetId)) {
      throw new Error(`Cannot add edge: vertices ${sourceId} and ${targetId} must both exist`);
    }

    // Check DAG cycle constraint
    if (this.enforceAcyclic) {
      if (sourceId === targetId || this.hasPath(targetId, sourceId)) {
        return { delta: this.emptyDelta(), success: false, cycleRejected: true };
      }
    }

    const edgeId = `${sourceId}->${targetId}`;
    const tag = this.nextTag();
    let edge = this.edges.get(edgeId);

    if (!edge) {
      edge = {
        edgeId,
        sourceId,
        targetId,
        weight,
        addTags: [tag],
        removeTags: [],
      };
      this.edges.set(edgeId, edge);
    } else {
      edge.weight = weight;
      edge.addTags.push(tag);
    }

    const delta: GraphDelta = {
      replicaId: this.replicaId,
      verticesAdded: [],
      verticesRemoved: [],
      edgesAdded: [{ sourceId, targetId, weight, tag }],
      edgesRemoved: [],
    };

    return { delta, success: true };
  }

  /**
   * Removes a directed edge.
   */
  public removeEdge(sourceId: string, targetId: string): GraphDelta {
    const edgeId = `${sourceId}->${targetId}`;
    const edge = this.edges.get(edgeId);
    if (!edge) {
      return this.emptyDelta();
    }

    const removedTags = [...edge.addTags];
    edge.removeTags.push(...removedTags);

    return {
      replicaId: this.replicaId,
      verticesAdded: [],
      verticesRemoved: [],
      edgesAdded: [],
      edgesRemoved: removedTags.map((t) => ({ sourceId, targetId, tag: t })),
    };
  }

  /**
   * Merges an incoming mutation delta from a peer node.
   */
  public mergeDelta(delta: GraphDelta): void {
    // 1. Merge added vertices
    for (const va of delta.verticesAdded) {
      let vertex = this.vertices.get(va.id);
      if (!vertex) {
        vertex = {
          id: va.id,
          label: va.label,
          properties: va.properties,
          addTags: [va.tag],
          removeTags: [],
        };
        this.vertices.set(va.id, vertex);
      } else {
        if (!this.containsTag(vertex.addTags, va.tag)) {
          vertex.addTags.push(va.tag);
          vertex.properties = { ...vertex.properties, ...va.properties };
        }
      }
    }

    // 2. Merge removed vertices (tombstones)
    for (const vr of delta.verticesRemoved) {
      const vertex = this.vertices.get(vr.id);
      if (vertex) {
        if (!this.containsTag(vertex.removeTags, vr.tag)) {
          vertex.removeTags.push(vr.tag);
        }
      }
    }

    // 3. Merge added edges
    for (const ea of delta.edgesAdded) {
      const edgeId = `${ea.sourceId}->${ea.targetId}`;
      let edge = this.edges.get(edgeId);
      if (!edge) {
        edge = {
          edgeId,
          sourceId: ea.sourceId,
          targetId: ea.targetId,
          weight: ea.weight,
          addTags: [ea.tag],
          removeTags: [],
        };
        this.edges.set(edgeId, edge);
      } else {
        if (!this.containsTag(edge.addTags, ea.tag)) {
          edge.addTags.push(ea.tag);
        }
      }
    }

    // 4. Merge removed edges
    for (const er of delta.edgesRemoved) {
      const edgeId = `${er.sourceId}->${er.targetId}`;
      const edge = this.edges.get(edgeId);
      if (edge) {
        if (!this.containsTag(edge.removeTags, er.tag)) {
          edge.removeTags.push(er.tag);
        }
      }
    }

    // If acyclic invariant is violated by concurrent merges, resolve cycle deterministically
    if (this.enforceAcyclic && !this.topologicalSort()) {
      this.breakCyclesDeterministically();
    }
  }

  /**
   * Merges full state of another StateGraphCRDT instance.
   */
  public mergeState(remote: StateGraphCRDT): void {
    // Merge all vertices
    for (const [id, rVertex] of remote.vertices.entries()) {
      let lVertex = this.vertices.get(id);
      if (!lVertex) {
        this.vertices.set(id, {
          id,
          label: rVertex.label,
          properties: { ...rVertex.properties },
          addTags: [...rVertex.addTags],
          removeTags: [...rVertex.removeTags],
        });
      } else {
        lVertex.addTags = this.unionTags(lVertex.addTags, rVertex.addTags);
        lVertex.removeTags = this.unionTags(lVertex.removeTags, rVertex.removeTags);
        lVertex.properties = { ...lVertex.properties, ...rVertex.properties };
      }
    }

    // Merge all edges
    for (const [edgeId, rEdge] of remote.edges.entries()) {
      let lEdge = this.edges.get(edgeId);
      if (!lEdge) {
        this.edges.set(edgeId, {
          edgeId,
          sourceId: rEdge.sourceId,
          targetId: rEdge.targetId,
          weight: rEdge.weight,
          addTags: [...rEdge.addTags],
          removeTags: [...rEdge.removeTags],
        });
      } else {
        lEdge.addTags = this.unionTags(lEdge.addTags, rEdge.addTags);
        lEdge.removeTags = this.unionTags(lEdge.removeTags, rEdge.removeTags);
      }
    }

    if (this.enforceAcyclic && !this.topologicalSort()) {
      this.breakCyclesDeterministically();
    }
  }

  /**
   * Checks if a vertex is currently active (Add-Wins: addTags not covered by removeTags).
   */
  public hasVertex(id: string): boolean {
    const v = this.vertices.get(id);
    if (!v) return false;
    return this.isElementActive(v.addTags, v.removeTags);
  }

  /**
   * Checks if a directed edge is active and both endpoints exist.
   */
  public hasEdge(sourceId: string, targetId: string): boolean {
    if (!this.hasVertex(sourceId) || !this.hasVertex(targetId)) return false;
    const edge = this.edges.get(`${sourceId}->${targetId}`);
    if (!edge) return false;
    return this.isElementActive(edge.addTags, edge.removeTags);
  }

  /**
   * BFS reachability query from start vertex to destination vertex.
   */
  public hasPath(fromId: string, toId: string): boolean {
    if (!this.hasVertex(fromId) || !this.hasVertex(toId)) return false;
    if (fromId === toId) return true;

    const visited = new Set<string>();
    const queue = [fromId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toId) return true;
      visited.add(current);

      for (const edge of this.edges.values()) {
        if (edge.sourceId === current && this.hasEdge(edge.sourceId, edge.targetId)) {
          if (!visited.has(edge.targetId)) {
            queue.push(edge.targetId);
          }
        }
      }
    }

    return false;
  }

  /**
   * Computes Kahn's algorithm topological sort for DAG verification.
   * Returns sorted vertex IDs array, or null if cycle exists.
   */
  public topologicalSort(): string[] | null {
    const activeVertices = new Set<string>();
    for (const v of this.vertices.values()) {
      if (this.hasVertex(v.id)) activeVertices.add(v.id);
    }

    const inDegree = new Map<string, number>();
    for (const id of activeVertices) {
      inDegree.set(id, 0);
    }

    for (const edge of this.edges.values()) {
      if (this.hasEdge(edge.sourceId, edge.targetId)) {
        inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      sorted.push(u);

      for (const edge of this.edges.values()) {
        if (edge.sourceId === u && this.hasEdge(edge.sourceId, edge.targetId)) {
          const newDeg = (inDegree.get(edge.targetId) ?? 1) - 1;
          inDegree.set(edge.targetId, newDeg);
          if (newDeg === 0) {
            queue.push(edge.targetId);
          }
        }
      }
    }

    return sorted.length === activeVertices.size ? sorted : null;
  }

  public getActiveVertices(): Array<{ id: string; label: string; properties: Record<string, unknown> }> {
    const result: Array<{ id: string; label: string; properties: Record<string, unknown> }> = [];
    for (const v of this.vertices.values()) {
      if (this.hasVertex(v.id)) {
        result.push({ id: v.id, label: v.label, properties: v.properties });
      }
    }
    return result;
  }

  public getActiveEdges(): Array<{ sourceId: string; targetId: string; weight: number }> {
    const result: Array<{ sourceId: string; targetId: string; weight: number }> = [];
    for (const edge of this.edges.values()) {
      if (this.hasEdge(edge.sourceId, edge.targetId)) {
        result.push({ sourceId: edge.sourceId, targetId: edge.targetId, weight: edge.weight });
      }
    }
    return result;
  }

  // --- Internal Helpers ---

  private isElementActive(adds: CRDTElementTag[], removes: CRDTElementTag[]): boolean {
    if (adds.length === 0) return false;
    const removeKeys = new Set(removes.map((t) => `${t.replicaId}:${t.counter}`));
    return adds.some((t) => !removeKeys.has(`${t.replicaId}:${t.counter}`));
  }

  private nextTag(): CRDTElementTag {
    this.counter++;
    return {
      replicaId: this.replicaId,
      counter: this.counter,
      timestamp: Date.now(),
    };
  }

  private emptyDelta(): GraphDelta {
    return {
      replicaId: this.replicaId,
      verticesAdded: [],
      verticesRemoved: [],
      edgesAdded: [],
      edgesRemoved: [],
    };
  }

  private containsTag(list: CRDTElementTag[], tag: CRDTElementTag): boolean {
    return list.some((t) => t.replicaId === tag.replicaId && t.counter === tag.counter);
  }

  private unionTags(a: CRDTElementTag[], b: CRDTElementTag[]): CRDTElementTag[] {
    const map = new Map<string, CRDTElementTag>();
    for (const t of a) map.set(`${t.replicaId}:${t.counter}`, t);
    for (const t of b) map.set(`${t.replicaId}:${t.counter}`, t);
    return Array.from(map.values());
  }

  private breakCyclesDeterministically(): void {
    // If a cycle is present, find and tombstone the edge with the highest timestamp/counter
    const activeEdges = Array.from(this.edges.values()).filter((e) =>
      this.hasEdge(e.sourceId, e.targetId)
    );

    activeEdges.sort((a, b) => {
      const tagA = a.addTags[a.addTags.length - 1];
      const tagB = b.addTags[b.addTags.length - 1];
      return tagB.timestamp - tagA.timestamp || tagB.counter - tagA.counter;
    });

    for (const edge of activeEdges) {
      edge.removeTags.push(...edge.addTags);
      if (this.topologicalSort()) break; // Cycle successfully broken
    }
  }
}
