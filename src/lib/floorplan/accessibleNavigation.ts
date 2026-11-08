/**
 * Accessible & Step-Free Route Navigation Engine for 3D Floor Plans
 *
 * Implements Dijkstra / A* pathfinding with accessibility filtering, avoiding stairs,
 * turnstiles, and narrow corridors while prioritizing flat ramps and wide elevator halls.
 */

import { SCENE_SCALE, SVG_HEIGHT, SVG_WIDTH, get3DPosition } from "@/lib/floorPlan";
import type { SeatProps } from "@/components/floorplan/FloorPlanViewer3D";

export type NodeType =
  | "entrance"
  | "ramp"
  | "elevator"
  | "wide_corridor"
  | "stairs"
  | "turnstile"
  | "narrow_turn"
  | "desk";

export interface NavigationNode {
  id: string;
  name: string;
  x: number; // 3D X
  y: number; // 3D Y (elevation)
  z: number; // 3D Z
  type: NodeType;
  accessibleRoute: boolean; // Metadata property flagging step-free accessibility
  widthMeters: number; // Corridor width in meters
  description?: string;
  neighbors: Array<{
    nodeId: string;
    distance: number;
    accessibleRoute: boolean;
  }>;
}

export interface NavigationRoute {
  path: NavigationNode[];
  points3D: [number, number, number][];
  totalDistanceMeters: number;
  isAccessible: boolean;
  accessibleFeatures: string[];
  summary: string;
  hasStairs: boolean;
  hasTurnstiles: boolean;
}

/**
 * Static architectural waypoints for the venue floor plan.
 */
const BASE_WAYPOINTS: Omit<NavigationNode, "neighbors">[] = [
  {
    id: "main-entrance",
    name: "Main Entrance",
    x: 0,
    y: 0.05,
    z: 10,
    type: "entrance",
    accessibleRoute: true,
    widthMeters: 2.2,
    description: "Wide automatic sliding glass doors with level zero-threshold entry",
  },
  {
    id: "turnstile-gate",
    name: "Turnstile Security Gate",
    x: 3,
    y: 0.05,
    z: 7.5,
    type: "turnstile",
    accessibleRoute: false,
    widthMeters: 0.7,
    description: "Narrow tripod turnstile gate",
  },
  {
    id: "accessible-gate-ramp",
    name: "Wide Access Gate & Flat Ramp",
    x: -3,
    y: 0.05,
    z: 7.5,
    type: "ramp",
    accessibleRoute: true,
    widthMeters: 1.8,
    description: "1:14 slope flat access ramp with wide automatic sensor gate",
  },
  {
    id: "central-hub",
    name: "Central Atrium Corridor",
    x: 0,
    y: 0.05,
    z: 4,
    type: "wide_corridor",
    accessibleRoute: true,
    widthMeters: 2.5,
    description: "Spacious central concourse with non-slip flooring",
  },
  {
    id: "east-staircase",
    name: "East Mezzanine Stairs",
    x: 5,
    y: 0.6,
    z: 1,
    type: "stairs",
    accessibleRoute: false,
    widthMeters: 1.2,
    description: "8-step staircase with handrails",
  },
  {
    id: "west-elevator-hall",
    name: "Elevator Lobby & Wide Corridor",
    x: -4.5,
    y: 0.05,
    z: 1,
    type: "elevator",
    accessibleRoute: true,
    widthMeters: 2.0,
    description: "Accessible through-car elevator lobby with Braille & low-height call buttons",
  },
  {
    id: "north-flat-ramp",
    name: "North Deck Ramp",
    x: -4,
    y: 0.05,
    z: -3,
    type: "ramp",
    accessibleRoute: true,
    widthMeters: 1.6,
    description: "Step-free gradual ramp leading to quiet desk pods",
  },
  {
    id: "east-narrow-turn",
    name: "East Tight Corner Passage",
    x: 4.5,
    y: 0.05,
    z: -3,
    type: "narrow_turn",
    accessibleRoute: false,
    widthMeters: 0.75,
    description: "Narrow hallway with sharp 90-degree turn",
  },
  {
    id: "north-concourse",
    name: "North Workspace Concourse",
    x: 0,
    y: 0.05,
    z: -6,
    type: "wide_corridor",
    accessibleRoute: true,
    widthMeters: 2.0,
    description: "Wide open thoroughfare to northern hot desks and meeting suites",
  },
];

const BASE_EDGES: Array<{ from: string; to: string; distance: number; accessible: boolean }> = [
  // Entrance connections
  { from: "main-entrance", to: "turnstile-gate", distance: 4.0, accessible: false },
  { from: "main-entrance", to: "accessible-gate-ramp", distance: 4.5, accessible: true },

  // From gates to central hub
  { from: "turnstile-gate", to: "central-hub", distance: 4.5, accessible: false },
  { from: "accessible-gate-ramp", to: "central-hub", distance: 4.8, accessible: true },

  // Central hub to wings
  { from: "central-hub", to: "east-staircase", distance: 6.0, accessible: false },
  { from: "central-hub", to: "west-elevator-hall", distance: 5.5, accessible: true },

  // Wing connections
  { from: "west-elevator-hall", to: "north-flat-ramp", distance: 4.5, accessible: true },
  { from: "east-staircase", to: "east-narrow-turn", distance: 5.0, accessible: false },

  // Towards north concourse
  { from: "north-flat-ramp", to: "north-concourse", distance: 5.0, accessible: true },
  { from: "east-narrow-turn", to: "north-concourse", distance: 5.5, accessible: false },
];

/**
 * Builds the complete navigation graph including venue seats.
 */
export function buildNavigationGraph(seats: SeatProps[]): Map<string, NavigationNode> {
  const graph = new Map<string, NavigationNode>();

  // Add base waypoints
  for (const wp of BASE_WAYPOINTS) {
    graph.set(wp.id, {
      ...wp,
      neighbors: [],
    });
  }

  // Add base edges (bidirectional)
  for (const edge of BASE_EDGES) {
    const nodeA = graph.get(edge.from);
    const nodeB = graph.get(edge.to);
    if (nodeA && nodeB) {
      nodeA.neighbors.push({
        nodeId: edge.to,
        distance: edge.distance,
        accessibleRoute: edge.accessible,
      });
      nodeB.neighbors.push({
        nodeId: edge.from,
        distance: edge.distance,
        accessibleRoute: edge.accessible,
      });
    }
  }

  // Connect each seat to the nearest corridors / ramps
  for (const seat of seats) {
    const [sx, sy, sz] = get3DPosition(seat.x, seat.y, seat.width, seat.height, 0.25);
    const seatNodeId = `seat-node-${seat.id}`;

    const seatNode: NavigationNode = {
      id: seatNodeId,
      name: `Seat ${seat.seatNumber}`,
      x: sx,
      y: sy,
      z: sz,
      type: "desk",
      accessibleRoute: true,
      widthMeters: 1.5,
      description: `Desk ${seat.seatNumber} · ${seat.type.replace(/_/g, " ").toLowerCase()}`,
      neighbors: [],
    };

    graph.set(seatNodeId, seatNode);

    // Find closest waypoints to connect to
    let closestAccessibleNode: NavigationNode | null = null;
    let minAccDist = Infinity;

    let closestGeneralNode: NavigationNode | null = null;
    let minGenDist = Infinity;

    for (const [id, node] of graph.entries()) {
      if (id === seatNodeId || node.type === "desk") continue;

      const d = Math.hypot(sx - node.x, sz - node.z);

      if (d < minGenDist) {
        minGenDist = d;
        closestGeneralNode = node;
      }

      if (node.accessibleRoute && d < minAccDist) {
        minAccDist = d;
        closestAccessibleNode = node;
      }
    }

    if (closestAccessibleNode) {
      seatNode.neighbors.push({
        nodeId: closestAccessibleNode.id,
        distance: Math.max(1, minAccDist),
        accessibleRoute: true,
      });
      closestAccessibleNode.neighbors.push({
        nodeId: seatNodeId,
        distance: Math.max(1, minAccDist),
        accessibleRoute: true,
      });
    }

    if (closestGeneralNode && closestGeneralNode.id !== closestAccessibleNode?.id) {
      seatNode.neighbors.push({
        nodeId: closestGeneralNode.id,
        distance: Math.max(1, minGenDist),
        accessibleRoute: closestGeneralNode.accessibleRoute,
      });
      closestGeneralNode.neighbors.push({
        nodeId: seatNodeId,
        distance: Math.max(1, minGenDist),
        accessibleRoute: closestGeneralNode.accessibleRoute,
      });
    }
  }

  return graph;
}

/**
 * Calculates Dijkstra path from start node to destination seat node.
 */
export function calculateNavigationPath({
  seats,
  targetSeatId,
  accessibleOnly = false,
  startNodeId = "main-entrance",
}: {
  seats: SeatProps[];
  targetSeatId: string;
  accessibleOnly?: boolean;
  startNodeId?: string;
}): NavigationRoute | null {
  const graph = buildNavigationGraph(seats);
  const targetNodeId = `seat-node-${targetSeatId}`;

  if (!graph.has(startNodeId) || !graph.has(targetNodeId)) {
    return null;
  }

  const distances = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const unvisited = new Set<string>();

  for (const nodeId of graph.keys()) {
    distances.set(nodeId, Infinity);
    previous.set(nodeId, null);
    unvisited.add(nodeId);
  }

  distances.set(startNodeId, 0);

  while (unvisited.size > 0) {
    // Find node with minimum distance
    let currentId: string | null = null;
    let minDistance = Infinity;

    for (const nodeId of unvisited) {
      const dist = distances.get(nodeId)!;
      if (dist < minDistance) {
        minDistance = dist;
        currentId = nodeId;
      }
    }

    if (!currentId || minDistance === Infinity) break;
    if (currentId === targetNodeId) break;

    unvisited.delete(currentId);
    const currentNode = graph.get(currentId)!;

    for (const neighbor of currentNode.neighbors) {
      if (!unvisited.has(neighbor.nodeId)) continue;

      const neighborNode = graph.get(neighbor.nodeId);
      if (!neighborNode) continue;

      // In accessible mode, avoid non-accessible nodes and edges
      if (accessibleOnly && (!neighbor.accessibleRoute || !neighborNode.accessibleRoute)) {
        continue;
      }

      const alt = distances.get(currentId)! + neighbor.distance;
      if (alt < distances.get(neighbor.nodeId)!) {
        distances.set(neighbor.nodeId, alt);
        previous.set(neighbor.nodeId, currentId);
      }
    }
  }

  // Reconstruct path
  const path: NavigationNode[] = [];
  let curr: string | null = targetNodeId;

  while (curr) {
    const node = graph.get(curr);
    if (!node) break;
    path.unshift(node);
    curr = previous.get(curr) ?? null;
  }

  if (path.length === 0 || path[0].id !== startNodeId) {
    return null;
  }

  const points3D: [number, number, number][] = path.map((n) => [n.x, n.y + 0.1, n.z]);
  const totalDistanceMeters = Math.round(distances.get(targetSeatId ? targetNodeId : "") || 0);

  const accessibleFeatures: string[] = [];
  let hasStairs = false;
  let hasTurnstiles = false;

  for (const node of path) {
    if (node.type === "ramp") {
      accessibleFeatures.push(node.description || "Flat access ramp (1:14 slope)");
    } else if (node.type === "elevator") {
      accessibleFeatures.push(node.description || "Elevator concourse with level threshold");
    } else if (node.type === "stairs") {
      hasStairs = true;
    } else if (node.type === "turnstile") {
      hasTurnstiles = true;
    }
  }

  const isAccessible = !hasStairs && !hasTurnstiles;
  const targetSeat = seats.find((s) => s.id === targetSeatId);

  const summary = isAccessible
    ? `Step-Free Path to ${targetSeat?.seatNumber || "Seat"}: ${totalDistanceMeters}m · 0 stairs (Ramps & Elevators)`
    : `Standard Route to ${targetSeat?.seatNumber || "Seat"}: ${totalDistanceMeters}m (Includes stairs/turnstiles)`;

  return {
    path,
    points3D,
    totalDistanceMeters,
    isAccessible,
    accessibleFeatures: Array.from(new Set(accessibleFeatures)),
    summary,
    hasStairs,
    hasTurnstiles,
  };
}
