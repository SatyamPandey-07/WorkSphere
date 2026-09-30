/**
 * Tests for venue knowledge graph relationship management.
 */

interface KnowledgeNode {
  nodeId: string;
  type: "venue" | "amenity" | "area" | "category" | "user";
  name: string;
  attributes: Record<string, unknown>;
}

interface KnowledgeEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  relationship: string;
  weight: number;  // 0-1 strength
}

function directNeighbors(
  nodeId: string,
  edges: KnowledgeEdge[]
): string[] {
  const outgoing = edges.filter((e) => e.fromNodeId === nodeId).map((e) => e.toNodeId);
  const incoming = edges.filter((e) => e.toNodeId === nodeId).map((e) => e.fromNodeId);
  return [...new Set([...outgoing, ...incoming])];
}

function pathExists(
  fromId: string,
  toId: string,
  edges: KnowledgeEdge[],
  maxDepth = 3
): boolean {
  if (fromId === toId) return true;
  const visited = new Set<string>();
  const queue: { nodeId: string; depth: number }[] = [{ nodeId: fromId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const neighbors = directNeighbors(nodeId, edges);
    if (neighbors.includes(toId)) return true;
    neighbors.forEach((n) => queue.push({ nodeId: n, depth: depth + 1 }));
  }
  return false;
}

function avgEdgeWeight(edges: KnowledgeEdge[], fromId: string): number {
  const outgoing = edges.filter((e) => e.fromNodeId === fromId);
  if (outgoing.length === 0) return 0;
  return Math.round((outgoing.reduce((s, e) => s + e.weight, 0) / outgoing.length) * 100) / 100;
}

function strongestRelationships(
  nodeId: string,
  edges: KnowledgeEdge[],
  limit = 3
): KnowledgeEdge[] {
  return edges
    .filter((e) => e.fromNodeId === nodeId || e.toNodeId === nodeId)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

const NODES: KnowledgeNode[] = [
  { nodeId: "n1", type: "venue",   name: "Coffee Hub",   attributes: {} },
  { nodeId: "n2", type: "amenity", name: "WiFi",         attributes: {} },
  { nodeId: "n3", type: "amenity", name: "Coffee",       attributes: {} },
  { nodeId: "n4", type: "area",    name: "Downtown",     attributes: {} },
  { nodeId: "n5", type: "category",name: "Coworking",    attributes: {} },
];

const EDGES: KnowledgeEdge[] = [
  { edgeId: "e1", fromNodeId: "n1", toNodeId: "n2", relationship: "has_amenity",   weight: 0.9 },
  { edgeId: "e2", fromNodeId: "n1", toNodeId: "n3", relationship: "has_amenity",   weight: 0.85 },
  { edgeId: "e3", fromNodeId: "n1", toNodeId: "n4", relationship: "located_in",    weight: 0.95 },
  { edgeId: "e4", fromNodeId: "n1", toNodeId: "n5", relationship: "belongs_to",    weight: 0.8 },
];

describe("Venue knowledge graph", () => {
  it("directNeighbors: n1 has 4 neighbors", () => {
    expect(directNeighbors("n1", EDGES)).toHaveLength(4);
  });

  it("directNeighbors: n2 (WiFi) linked to n1 via incoming", () => {
    expect(directNeighbors("n2", EDGES)).toContain("n1");
  });

  it("pathExists: n1 → n2 (direct) → true", () => {
    expect(pathExists("n1", "n2", EDGES)).toBe(true);
  });

  it("pathExists: n2 → n4 (through n1) → true", () => {
    expect(pathExists("n2", "n4", EDGES)).toBe(true);
  });

  it("pathExists: n2 → n6 (doesn't exist) → false", () => {
    expect(pathExists("n2", "n6", EDGES)).toBe(false);
  });

  it("avgEdgeWeight: n1 = (0.9+0.85+0.95+0.8)/4 = 0.875", () => {
    expect(avgEdgeWeight(EDGES, "n1")).toBe(0.875);
  });

  it("strongestRelationships: highest weight first", () => {
    const strongest = strongestRelationships("n1", EDGES, 2);
    expect(strongest[0].weight).toBeGreaterThanOrEqual(strongest[1].weight);
  });
});
