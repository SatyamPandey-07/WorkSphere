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
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  relationship: string; // e.g., 'PREFERS', 'REJECTED', 'HAS_FEATURE', 'VISITED'
  weight: number;
  properties: Record<string, string | number | boolean>;
  createdAt: number;
}

export class GraphMemory {
  private nodes: Map<string, GraphNode>;
  private edges: Map<string, GraphEdge[]>; // Adjacency list: sourceId -> edges

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  public addNode(node: GraphNode): void {
    this.nodes.set(node.id, { ...node, createdAt: Date.now() });
    if (!this.edges.has(node.id)) {
      this.edges.set(node.id, []);
    }
  }

  public addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.sourceId) || !this.nodes.has(edge.targetId)) {
      throw new Error('Both source and target nodes must exist before adding an edge.');
    }
    
    const newEdge = { ...edge, createdAt: Date.now() };
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

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  public getConnectedNodes(sourceId: string, relationship?: string): GraphNode[] {
    const sourceEdges = this.edges.get(sourceId) || [];
    const filteredEdges = relationship 
      ? sourceEdges.filter(e => e.relationship === relationship)
      : sourceEdges;

    return filteredEdges
      .map(e => this.nodes.get(e.targetId))
      .filter((node): node is GraphNode => node !== undefined);
  }

  public getUserPreferences(userId: string): { featureId: string; weight: number }[] {
    const preferredFeatures = this.getConnectedNodes(userId, 'PREFERS');
    return preferredFeatures.map(node => ({
      featureId: node.id,
      weight: this.edges.get(userId)?.find(e => e.targetId === node.id && e.relationship === 'PREFERS')?.weight || 1
    }));
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

  public importGraph(data: { nodes: GraphNode[]; edges: GraphEdge[] }): void {
    this.nodes.clear();
    this.edges.clear();
    
    data.nodes.forEach(node => this.addNode(node));
    data.edges.forEach(edge => this.addEdge(edge));
  }
}
