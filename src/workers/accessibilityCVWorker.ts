/**
 * accessibilityCVWorker.ts
 * Web Worker that streams OffscreenCanvas frames to the WASM module 
 * and handles the heavy CV inference off-thread.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

// Mock WASM module interface
interface WasmModule {
    _estimate_depth: (ptr: number, w: number, h: number, outPtr: number) => void;
    _add_object: (x: number, y: number, w: number, h: number, type: number, depth: number, iw: number, ih: number) => void;
    _clear_scene: () => void;
    _get_scene_graph: (ptr: number) => void;
    _get_object_count: () => number;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    HEAPU8: Uint8Array;
    HEAPF32: Float32Array;
}

let wasmModule: WasmModule | null = null;

self.addEventListener('message', async (event) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        // In production, fetch and instantiate the WASM binary
        // const response = await fetch('/wasm/vision.wasm');
        // const buffer = await response.arrayBuffer();
        // wasmModule = await WebAssembly.instantiate(buffer, ...);
        console.log('[CVWorker] WASM Module initialized (mocked)');
        self.postMessage({ type: 'READY' });
    }
    else if (type === 'PROCESS_FRAME') {
        if (!wasmModule) {
            self.postMessage({ type: 'ERROR', error: 'WASM not initialized' });
            return;
        }

        const { imageData, width, height, boundingBoxes } = payload;

        // 1. Allocate memory for image data
        const imgPtr = wasmModule._malloc(imageData.length);
        wasmModule.HEAPU8.set(imageData, imgPtr);

        // 2. Allocate memory for depth map
        const depthSize = width * height * 4; // Float32
        const depthPtr = wasmModule._malloc(depthSize);

        // 3. Run depth estimation
        wasmModule._estimate_depth(imgPtr, width, height, depthPtr);

        // 4. Clear previous scene graph
        wasmModule._clear_scene();

        // 5. Process bounding boxes (from a mock object detector)
        for (const box of boundingBoxes) {
            // Sample depth from the center of the bounding box
            const cx = Math.floor(box.x + box.w / 2);
            const cy = Math.floor(box.y + box.h / 2);
            const depthIdx = cy * width + cx;
            const depth = wasmModule.HEAPF32[depthPtr / 4 + depthIdx];

            wasmModule._add_object(box.x, box.y, box.w, box.h, box.type, depth, width, height);
        }

        // 6. Extract scene graph
        const objCount = wasmModule._get_object_count();
        const graphSize = objCount * 5 * 4; // 5 floats per object
        const graphPtr = wasmModule._malloc(graphSize);

        wasmModule._get_scene_graph(graphPtr);

        const graphData = new Float32Array(objCount * 5);
        graphData.set(wasmModule.HEAPF32.subarray(graphPtr / 4, graphPtr / 4 + objCount * 5));

        // 7. Cleanup
        wasmModule._free(imgPtr);
        wasmModule._free(depthPtr);
        wasmModule._free(graphPtr);

        self.postMessage({
            type: 'SCENE_GRAPH_UPDATED',
            objects: Array.from(graphData),
            objectCount: objCount
        });
    }
});
