/// <reference lib="webworker" />
declare let self: DedicatedWorkerGlobalScope;
declare function importScripts(...urls: string[]): void;

export type RouteRequest = {
  type: "CALCULATE_ROUTE";
  id: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
};

export type LoadGraphRequest = {
  type: "LOAD_GRAPH";
  nodes: { lat: number; lng: number }[];
  edges: { source: number; target: number; weight: number }[];
};

export type RouteResponse = {
  type: "ROUTE_RESULT";
  id: string;
  success: boolean;
  route?: any; // GeoJSON
  error?: string;
  latencyMs?: number;
};

// Global variables for WASM instance
let wasmModule: any = null;
let graphLoaded = false;

// We need to load the Emscripten generated JS file.
// In Next.js, this is usually placed in the public folder.
importScripts("/wasm/routing-engine.js");

async function initWasm() {
  if (!wasmModule) {
    // createRoutingEngine is exported via MODULARIZE=1 in Emscripten
    wasmModule = await (self as any).createRoutingEngine({
      locateFile: (path: string) => `/wasm/${path}`,
    });
  }
}

async function handleLoadGraph(req: LoadGraphRequest) {
  try {
    graphLoaded = false;

    await initWasm();

    const { nodes, edges } = req;

    if (nodes.length === 0) {
      throw new Error("Routing graph contains no nodes.");
    }

    for (const edge of edges) {
      if (
        edge.source < 0 ||
        edge.source >= nodes.length ||
        edge.target < 0 ||
        edge.target >= nodes.length
      ) {
        throw new Error("Routing graph contains an invalid edge.");
      }
    }

    const numNodes = nodes.length;

    wasmModule._init_graph(numNodes);

    for (let i = 0; i < numNodes; i++) {
      wasmModule._set_node(i, nodes[i].lat, nodes[i].lng);
    }

    for (const edge of edges) {
      wasmModule._add_edge(
        edge.source,
        edge.target,
        edge.weight,
      );
    }

    // Update JS state only after WASM graph loading succeeds.
    jsNodes = nodes.map((node) => ({
      lat: node.lat,
      lng: node.lng,
    }));

    graphLoaded = true;

    self.postMessage({ type: "GRAPH_LOADED" });
  } catch (error) {
    graphLoaded = false;
    jsNodes = [];

    self.postMessage({
      type: "GRAPH_LOAD_ERROR",
      error:
        error instanceof Error
          ? error.message
          : "Failed to load routing graph.",
    });
  }
}

// Keep track of nodes in JS to find closest node quickly
let jsNodes: { lat: number; lng: number }[] = [];

async function handleCalculateRoute(req: RouteRequest) {
  const startTime = performance.now();

  if (!graphLoaded || !wasmModule) {
    self.postMessage({
      type: "ROUTE_RESULT",
      id: req.id,
      success: false,
      error: "Graph not loaded into WASM memory yet.",
    } as RouteResponse);
    return;
  }

  // Very naive O(N) closest node search for demonstration.
  // In production, an R-Tree or KD-Tree should be used.
  let startNodeId = -1;
  let endNodeId = -1;
  let minDistStart = Infinity;
  let minDistEnd = Infinity;

  for (let i = 0; i < jsNodes.length; i++) {
    const node = jsNodes[i];
    const dStart = Math.hypot(
      node.lat - req.start.lat,
      node.lng - req.start.lng,
    );
    const dEnd = Math.hypot(node.lat - req.end.lat, node.lng - req.end.lng);

    if (dStart < minDistStart) {
      minDistStart = dStart;
      startNodeId = i;
    }
    if (dEnd < minDistEnd) {
      minDistEnd = dEnd;
      endNodeId = i;
    }
  }

  if (startNodeId === -1 || endNodeId === -1) {
    self.postMessage({
      type: "ROUTE_RESULT",
      id: req.id,
      success: false,
      error: "Could not find nearby nodes in the routing graph.",
    } as RouteResponse);
    return;
  }

  // Call C++ Dijkstra
  const pathPtr = wasmModule._find_shortest_path(startNodeId, endNodeId);
  const pathSize = wasmModule._get_last_path_size();

  if (pathPtr === 0 || pathSize === 0) {
    self.postMessage({
      type: "ROUTE_RESULT",
      id: req.id,
      success: false,
      error: "No route found between coordinates.",
    } as RouteResponse);
    return;
  }

  // Read array from WASM memory
  const pathArray = new Int32Array(wasmModule.HEAP32.buffer, pathPtr, pathSize);

  // Build GeoJSON LineString
  const coordinates = [];
  for (let i = 0; i < pathSize; i++) {
    const nodeId = pathArray[i];
    const lat = wasmModule._get_node_lat(nodeId);
    const lng = wasmModule._get_node_lng(nodeId);
    // GeoJSON is [lng, lat]
    coordinates.push([lng, lat]);
  }

  const geoJson = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
        properties: {},
      },
    ],
  };

  const latencyMs = performance.now() - startTime;

  self.postMessage({
    type: "ROUTE_RESULT",
    id: req.id,
    success: true,
    route: geoJson,
    latencyMs,
  } as RouteResponse);
}

self.onmessage = async (e: MessageEvent) => {
  const data = e.data;
  if (data.type === "LOAD_GRAPH") {
    jsNodes = data.nodes;
    await handleLoadGraph(data as LoadGraphRequest);
  } else if (data.type === "CALCULATE_ROUTE") {
    await handleCalculateRoute(data as RouteRequest);
  }
};
