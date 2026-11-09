/**
 * heatmap.worker.ts
 * Web Worker that handles WebGL heatmap texture rendering on an OffscreenCanvas
 * to prevent main thread blocking during heavy geographic data processing.
 */

import { OffscreenHeatmapRenderer } from '@/lib/admin/OffscreenHeatmapRenderer';

let renderer: OffscreenHeatmapRenderer | null = null;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        const { canvas, width, height } = payload;
        const offscreen = canvas.transferControlToOffscreen();
        renderer = new OffscreenHeatmapRenderer(offscreen, width, height);
        self.postMessage({ type: 'READY' });
    }

    if (type === 'UPDATE_DATA' && renderer) {
        const { coordinates, intensities } = payload;
        renderer.updateData(coordinates, intensities);
        renderer.render();

        // Optionally, we could transfer an ImageBitmap back, but for this scaffold 
        // the worker draws directly to the transferred OffscreenCanvas.
        self.postMessage({ type: 'RENDER_COMPLETE' });
    }

    if (type === 'RESIZE' && renderer) {
        const { width, height } = payload;
        renderer.resize(width, height);
        renderer.render();
    }
};
