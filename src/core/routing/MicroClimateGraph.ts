/**
 * MicroClimateGraph.ts
 * Constructs a specialized pedestrian routing graph weighted by real-time 
 * micro-climate penalties rather than just distance.
 */

export interface GraphNode {
  id: string;
  lat: number;
  lon: number;
  elevation: number;
  isIndoor: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  distance: number; // meters
  baseWeight: number;
  climatePenalty: number;
  windSpeed: number; // m/s
  uvIndex: number;
  shadeFactor: number; // 0.0 (full sun) to 1.0 (full shade)
  floodRisk: number; // 0.0 to 1.0
}

export interface RouteResult {
  path: string[];
  totalDistance: number;
  totalPenalty: number;
  estimatedTimeMs: number;
  hazards: string[];
}

export class MicroClimateGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private adjacencyList: Map<string, GraphEdge[]> = new Map();

  public addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.adjacencyList.has(node.id)) {
      this.adjacencyList.set(node.id, []);
    }
  }

  public addEdge(edge: GraphEdge): void {
    if (!this.adjacencyList.has(edge.source)) {
      this.adjacencyList.set(edge.source, []);
    }
    this.adjacencyList.get(edge.source)!.push(edge);
    
    // Bidirectional for pedestrian routing
    const reverseEdge: GraphEdge = { ...edge, source: edge.target, target: edge.source };
    if (!this.adjacencyList.has(edge.target)) {
      this.adjacencyList.set(edge.target, []);
    }
    this.adjacencyList.get(edge.target)!.push(reverseEdge);
  }

  public updateEdgeClimateData(source: string, target: string, climateData: Partial<GraphEdge>): void {
    const edges = this.adjacencyList.get(source) || [];
    const edge = edges.find(e => e.target === target);
    if (edge) {
      Object.assign(edge, climateData);
      edge.climatePenalty = this.calculatePenalty(edge);
    }
  }

  private calculatePenalty(edge: GraphEdge): number {
    let penalty = 0;
    
    // Wind penalty: Exponential increase in discomfort above 5 m/s
    if (edge.windSpeed > 5) {
      penalty += Math.pow(edge.windSpeed - 5, 2) * 10;
    }
    
    // UV penalty: High UV without shade is heavily penalized
    if (edge.uvIndex > 6) {
      penalty += (edge.uvIndex - 6) * 20 * (1 - edge.shadeFactor);
    }
    
    // Flood risk penalty
    penalty += edge.floodRisk * 50;
    
    return penalty;
  }

  public findOptimalPath(startId: string, endId: string, walkingSpeedMps: number = 1.4): RouteResult | null {
    const distances = new Map<string, number>();
    const penalties = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const pq = new PriorityQueue<string>();
    const hazards: Set<string> = new Set();

    for (const node of this.nodes.keys()) {
      distances.set(node, Infinity);
      penalties.set(node, Infinity);
      prev.set(node, null);
    }

    distances.set(startId, 0);
    penalties.set(startId, 0);
    pq.enqueue(startId, 0);

    while (!pq.isEmpty()) {
      const current = pq.dequeue()!;
      
      if (current === endId) break;

      const edges = this.adjacencyList.get(current) || [];
      for (const edge of edges) {
        // Total weight = distance + climate penalty
        const edgeWeight = edge.distance + edge.climatePenalty;
        const newDist = distances.get(current)! + edge.distance;
        const newPenalty = penalties.get(current)! + edgeWeight;

        if (newPenalty < penalties.get(edge.target)!) {
          distances.set(edge.target, newDist);
          penalties.set(edge.target, newPenalty);
          prev.set(edge.target, current);
          pq.enqueue(edge.target, newPenalty);
          
          if (edge.windSpeed > 10) hazards.add('High Wind Corridor');
          if (edge.uvIndex > 8 && edge.shadeFactor < 0.3) hazards.add('Extreme UV Exposure');
          if (edge.floodRisk > 0.7) hazards.add('Flood/Puddle Risk');
        }
      }
    }

    if (prev.get(endId) === null && startId !== endId) return null;

    const path: string[] = [];
    let curr = endId;
    while (curr !== null) {
      path.unshift(curr);
      curr = prev.get(curr)!;
    }

    return {
      path,
      totalDistance: distances.get(endId)!,
      totalPenalty: penalties.get(endId)!,
      estimatedTimeMs: (distances.get(endId)! / walkingSpeedMps) * 1000,
      hazards: Array.from(hazards)
    };
  }
}

// Simple Priority Queue implementation for Dijkstra
class PriorityQueue<T> {
  private items: { element: T; priority: number }[] = [];

  public enqueue(element: T, priority: number): void {
    this.items.push({ element, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  public dequeue(): T | undefined {
    return this.items.shift()?.element;
  }

  public isEmpty(): boolean {
    return this.items.length === 0;
  }
}
