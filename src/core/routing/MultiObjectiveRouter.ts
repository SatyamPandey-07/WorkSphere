import { GeoCoordinate, admissibleHeuristic, calculateGreatCircleDistance } from '../../lib/geo/heuristic';

export interface RouteNode {
  id: string;
  coord: GeoCoordinate;
  elevationMeters: number;
  wifiQualityScore: number; // 0.0 to 1.0
}

export interface RouteEdge {
  fromId: string;
  toId: string;
  weight: number; // Cost (e.g., seconds or composite penalty)
  elevationGain: number;
}

export interface RouteGraph {
  nodes: Map<string, RouteNode>;
  adjacencyList: Map<string, RouteEdge[]>;
}

export interface RoutingOptions {
  epsilon?: number; // Epsilon-admissible scaling weight
  elevationPenaltyWeight?: number;
  wifiBonusWeight?: number;
}

export class MultiObjectiveRouter {
  private graph: RouteGraph;

  constructor(graph: RouteGraph) {
    this.graph = graph;
  }

  public findOptimalRoute(startId: string, goalId: string, options: RoutingOptions = {}): string[] | null {
    const startNode = this.graph.nodes.get(startId);
    const goalNode = this.graph.nodes.get(goalId);

    if (!startNode || !goalNode) return null;

    const epsilon = options.epsilon || 1.0;
    const gScore: Map<string, number> = new Map();
    const fScore: Map<string, number> = new Map();
    const cameFrom: Map<string, string> = new Map();

    const openSet: Set<string> = new Set([startId]);

    for (const nodeId of this.graph.nodes.keys()) {
      gScore.set(nodeId, Infinity);
      fScore.set(nodeId, Infinity);
    }

    gScore.set(startId, 0);
    fScore.set(startId, admissibleHeuristic(startNode.coord, goalNode.coord, epsilon));

    while (openSet.size > 0) {
      // Find node in openSet with lowest fScore
      let currentId: string | null = null;
      let lowestF = Infinity;

      for (const id of openSet) {
        const score = fScore.get(id) ?? Infinity;
        if (score < lowestF) {
          lowestF = score;
          currentId = id;
        }
      }

      if (!currentId) break;

      if (currentId === goalId) {
        return this.reconstructPath(cameFrom, goalId);
      }

      openSet.delete(currentId);
      const currentNode = this.graph.nodes.get(currentId);
      const edges = this.graph.adjacencyList.get(currentId) || [];

      for (const edge of edges) {
        const neighborNode = this.graph.nodes.get(edge.toId);
        if (!neighborNode || !currentNode) continue;

        // Composite multi-objective cost calculation
        const baseCost = edge.weight;
        const elevationPenalty = Math.max(0, edge.elevationGain) * (options.elevationPenaltyWeight || 0.5);
        const wifiBonus = neighborNode.wifiQualityScore * (options.wifiBonusWeight || 10.0);
        
        const tentativeG = (gScore.get(currentId) ?? Infinity) + baseCost + elevationPenalty - wifiBonus;

        if (tentativeG < (gScore.get(edge.toId) ?? Infinity)) {
          cameFrom.set(edge.toId, currentId);
          gScore.set(edge.toId, tentativeG);
          
          const h = admissibleHeuristic(neighborNode.coord, goalNode.coord, epsilon);
          fScore.set(edge.toId, tentativeG + h);

          if (!openSet.has(edge.toId)) {
            openSet.add(edge.toId);
          }
        }
      }
    }

    return null; // No path found
  }

  private reconstructPath(cameFrom: Map<string, string>, currentId: string): string[] {
    const path: string[] = [currentId];
    let curr = currentId;
    while (cameFrom.has(curr)) {
      curr = cameFrom.get(curr)!;
      path.unshift(curr);
    }
    return path;
  }
}