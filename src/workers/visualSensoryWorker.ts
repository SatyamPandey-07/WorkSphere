import { SensoryOverloadRenderer } from '../core/webgl/SensoryOverloadRenderer';

let renderer: SensoryOverloadRenderer | null = null;

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            // OffscreenCanvas is passed via payload or transferred
            renderer = new SensoryOverloadRenderer(payload.canvas);
            await renderer.init();
            self.postMessage({ type: 'READY' });
        } catch (err: any) {
            self.postMessage({ type: 'ERROR', message: err.message });
        }
    }

    if (type === 'ANALYZE') {
        if (!renderer) return;

        const { zoneId } = payload;
        // In a real worker, we would bind the VideoFrame/Canvas to the WebGL texture
        const results = renderer.analyzeFrame(null as any);

        self.postMessage({
            type: 'SENSORY_RESULT',
            payload: { zoneId, ...results, timestamp: Date.now() }
        });
    }
};
