/**
 * routingWorker.ts
 * Web Worker to execute the heavy graph traversal algorithms off the main UI thread.
 * Prevents UI freezing during complex multi-modal route calculations.
 */

import { TransitGraphBuilder } from '@/core/routing/TransitGraphBuilder';
import { MultiModalDijkstra } from '@/core/routing/MultiModalDijkstra';

let graphBuilder: TransitGraphBuilder | null = null;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT_GRAPH') {
        graphBuilder = new TransitGraphBuilder();
        for (const node of payload.nodes) {
            graphBuilder.addNode(node);
        }
        for (const edge of payload.edges) {
            graphBuilder.addEdge(edge);
        }
        self.postMessage({ type: 'GRAPH_READY', success: true });
    }

    if (type === 'CALCULATE_ROUTE' && graphBuilder) {
        const { startNodeId, endNodeId, timeWeight, costWeight } = payload;

        const dijkstra = new MultiModalDijkstra(graphBuilder, timeWeight, costWeight);
        const route = dijkstra.findOptimalRoute(startNodeId, endNodeId);

        self.postMessage({
            type: 'ROUTE_RESULT',
            payload: route
        });
    }
};
