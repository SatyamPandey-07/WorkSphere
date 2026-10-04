/**
 * Tests for venue booking social graph and network analytics.
 */

interface GraphNode {
  id: string;
  type: "user" | "venue" | "event";
  metadata: Record<string, string | number>;
}

interface GraphEdge {
  fromId: string;
  toId: string;
  type: "booked" | "reviewed" | "recommended" | "connected";
  weight: number;
}

function nodeNeighbors(nodeId: string, edges: GraphEdge[], edgeType?: GraphEdge["type"]): string[] {
  return edges
    .filter((e) => e.fromId === nodeId && (!edgeType || e.type === edgeType))
    .map((e) => e.toId);
}

function inDegree(nodeId: string, edges: GraphEdge[]): number {
  return edges.filter((e) => e.toId === nodeId).length;
}

function outDegree(nodeId: string, edges: GraphEdge[]): number {
  return edges.filter((e) => e.fromId === nodeId).length;
}

function stronglyConnected(nodeA: string, nodeB: string, edges: GraphEdge[]): boolean {
  const aNeighbors = new Set(nodeNeighbors(nodeA, edges));
  const bNeighbors = new Set(nodeNeighbors(nodeB, edges));
  return aNeighbors.has(nodeB) && bNeighbors.has(nodeA);
}

function mostConnectedNode(nodes: GraphNode[], edges: GraphEdge[]): GraphNode | null {
  if (nodes.length === 0) return null;
  return nodes.reduce((max, n) => {
    const degree = inDegree(n.id, edges) + outDegree(n.id, edges);
    const maxDegree = inDegree(max.id, edges) + outDegree(max.id, edges);
    return degree > maxDegree ? n : max;
  }, nodes[0]);
}

function edgeWeightSum(fromId: string, edges: GraphEdge[]): number {
  return edges.filter((e) => e.fromId === fromId).reduce((s, e) => s + e.weight, 0);
}

const NODES: GraphNode[] = [
  { id: "u1", type: "user",  metadata: {} },
  { id: "u2", type: "user",  metadata: {} },
  { id: "v1", type: "venue", metadata: {} },
  { id: "v2", type: "venue", metadata: {} },
];
const EDGES: GraphEdge[] = [
  { fromId: "u1", toId: "v1", type: "booked",      weight: 3 },
  { fromId: "u1", toId: "v2", type: "reviewed",     weight: 1 },
  { fromId: "u2", toId: "v1", type: "booked",       weight: 2 },
  { fromId: "u2", toId: "u1", type: "recommended",  weight: 1 },
  { fromId: "v1", toId: "u1", type: "recommended",  weight: 2 },
];

describe("Social graph and network analytics", () => {
  it("nodeNeighbors: u1 connects to v1 and v2", () => {
    const neighbors = nodeNeighbors("u1", EDGES);
    expect(neighbors).toContain("v1");
    expect(neighbors).toContain("v2");
  });

  it("inDegree: v1 receives from u1 and u2 → 2", () => {
    expect(inDegree("v1", EDGES)).toBe(2);
  });

  it("outDegree: u1 sends to v1 and v2 → 2", () => {
    expect(outDegree("u1", EDGES)).toBe(2);
  });

  it("stronglyConnected: u1 ↔ v1 are mutually connected", () => {
    expect(stronglyConnected("u1", "v1", EDGES)).toBe(true);
  });

  it("stronglyConnected: u1 → v2 but v2 ↛ u1 → false", () => {
    expect(stronglyConnected("u1", "v2", EDGES)).toBe(false);
  });

  it("edgeWeightSum: u1 total = 3+1 = 4", () => {
    expect(edgeWeightSum("u1", EDGES)).toBe(4);
  });
});
