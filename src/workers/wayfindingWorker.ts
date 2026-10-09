/**
 * wayfindingWorker.ts
 * Web Worker to handle the heavy graph construction and pathfinding computations for large venue complexes.
 * Prevents UI thread blocking during complex accessibility routing calculations.
 */

import { WayfindingGraph } from '@/core/accessibility/WayfindingGraph';
import { AccessibilityRouter, MobilityProfile } from '@/core/accessibility/AccessibilityRouter';

let graph: WayfindingGraph | null = null;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'BUILD_GRAPH') {
        graph = new WayfindingGraph();
        graph.parseOSMData(payload.osmElements);
        self.postMessage({ type: 'GRAPH_BUILT', success: true });
    }

    if (type === 'FIND_ROUTE' && graph) {
        const { startId, endId, profile } = payload as {
            startId: string;
            endId: string;
            profile: MobilityProfile;
        };

        const router = new AccessibilityRouter(graph, profile);
        const route = router.findOptimalRoute(startId, endId);

        self.postMessage({
            type: 'ROUTE_FOUND',
            payload: route
        });
    }
};
