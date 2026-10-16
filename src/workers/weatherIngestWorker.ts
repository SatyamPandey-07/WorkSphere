/**
 * weatherIngestWorker.ts
 * Web Worker that processes continuous meteorological webhooks and 
 * updates the routing graph weights asynchronously.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface WeatherUpdate {
    type: 'WEATHER_UPDATE' | 'INIT_GRAPH' | 'QUERY_ROUTE';
    payload: any;
}

interface NodeState {
    id: string;
    lat: number;
    lon: number;
    uvIndex: number;
    tempC: number;
    humidity: number;
    precipitationMm: number;
    windSpeed: number;
    windDir: number;
}

const nodeStates = new Map<string, NodeState>();
let lastUpdateTime = 0;
const UPDATE_THROTTLE_MS = 5000;

self.addEventListener('message', (event: MessageEvent<WeatherUpdate>) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT_GRAPH':
            initializeNodes(payload.nodes);
            break;
        case 'WEATHER_UPDATE':
            processWeatherData(payload);
            break;
        case 'QUERY_ROUTE':
            // In a real app, the main thread handles routing using the state, 
            // but we can do heavy preprocessing here.
            preprocessHazards(payload);
            break;
    }
});

function initializeNodes(nodes: any[]) {
    nodeStates.clear();
    for (const node of nodes) {
        nodeStates.set(node.id, {
            ...node,
            uvIndex: 0,
            tempC: 20,
            humidity: 50,
            precipitationMm: 0,
            windSpeed: 0,
            windDir: 0
        });
    }
    self.postMessage({ type: 'GRAPH_INITIALIZED', nodeCount: nodeStates.size });
}

function processWeatherData(data: {
    gridData: { lat: number; lon: number; uv: number; temp: number; wind: number; windDir: number; precip: number }[],
    timestamp: number
}) {
    if (Date.now() - lastUpdateTime < UPDATE_THROTTLE_MS) return;

    const updates: { id: string; climatePenalty: number; hazards: string[] }[] = [];

    for (const [id, node] of nodeStates.entries()) {
        // Find nearest grid point (simplified nearest-neighbor for demo)
        let nearest = data.gridData[0];
        let minDist = Infinity;

        for (const grid of data.gridData) {
            const dist = Math.pow(node.lat - grid.lat, 2) + Math.pow(node.lon - grid.lon, 2);
            if (dist < minDist) {
                minDist = dist;
                nearest = grid;
            }
        }

        node.uvIndex = nearest.uv;
        node.tempC = nearest.temp;
        node.windSpeed = nearest.wind;
        node.windDir = nearest.windDir;
        node.precipitationMm = nearest.precip;

        // Calculate localized penalty score
        let penalty = 0;
        const hazards: string[] = [];

        if (node.uvIndex >= 8) {
            penalty += 30;
            hazards.push('Extreme UV');
        } else if (node.uvIndex >= 6) {
            penalty += 15;
        }

        if (node.windSpeed > 12) {
            penalty += 40;
            hazards.push('High Wind');
        } else if (node.windSpeed > 8) {
            penalty += 20;
        }

        if (node.precipitationMm > 2.5) {
            penalty += 50;
            hazards.push('Heavy Rain/Flooding');
        } else if (node.precipitationMm > 0.5) {
            penalty += 10;
            hazards.push('Puddle Risk');
        }

        // Thermal comfort index (simplified Humidex)
        if (node.tempC > 27 && node.humidity > 60) {
            penalty += 25;
            hazards.push('Heat Stress');
        }

        updates.push({ id, climatePenalty: penalty, hazards });
    }

    lastUpdateTime = Date.now();
    self.postMessage({ type: 'CLIMATE_WEIGHTS_UPDATED', updates, timestamp: lastUpdateTime });
}

function preprocessHazards(payload: { path: string[] }) {
    const pathHazards = new Set<string>();

    for (const nodeId of payload.path) {
        const node = nodeStates.get(nodeId);
        if (node) {
            if (node.uvIndex >= 8) pathHazards.add('UV Exposure');
            if (node.windSpeed > 10) pathHazards.add('Wind Tunnel');
            if (node.precipitationMm > 1) pathHazards.add('Wet Surfaces');
        }
    }

    self.postMessage({
        type: 'HAZARDS_PREPROCESSED',
        path: payload.path,
        hazards: Array.from(pathHazards)
    });
}
