/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface WasmExports {
    memory: WebAssembly.Memory;
    ocr_preprocess_grayscale: (rgba: number, gray: number, w: number, h: number) => void;
    ocr_binarize_otsu: (gray: number, binary: number, w: number, h: number) => void;
    ocr_extract_components: (binary: number, w: number, h: number) => number;
    ocr_get_bounding_boxes: (out: number) => void;
    ar_calculate_homography: (src: number, dst: number, count: number) => void;
    ar_transform_points: (inPts: number, outPts: number, count: number) => void;
    ar_draw_bounding_box: (buf: number, fw: number, fh: number, x: number, y: number, w: number, h: number, r: number, g: number, b: number) => void;
}

let wasmInstance: WasmExports | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

async function initWasm() {
    try {
        const response = await fetch('/wasm/menu_vision.wasm');
        const bytes = await response.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(bytes, {
            env: {
                memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
            },
        });
        wasmInstance = instance.exports as unknown as WasmExports;
        self.postMessage({ type: 'WASM_READY' });
    } catch (error) {
        self.postMessage({ type: 'WASM_ERROR', error: String(error) });
    }
}

function processFrame(imageData: ImageData, profile: string[]) {
    if (!wasmInstance || !ctx || !canvas) return;

    const { width, height, data } = imageData;
    const pixelCount = width * height;

    const rgbaPtr = 0;
    const grayPtr = pixelCount * 4;
    const binaryPtr = grayPtr + pixelCount;
    const boxesPtr = binaryPtr + pixelCount;

    const heap = new Uint8Array(wasmInstance.memory.buffer);
    heap.set(data, rgbaPtr);

    wasmInstance.ocr_preprocess_grayscale(rgbaPtr, grayPtr, width, height);
    wasmInstance.ocr_binarize_otsu(grayPtr, binaryPtr, width, height);

    const boxCount = wasmInstance.ocr_extract_components(binaryPtr, width, height);
    if (boxCount > 0) {
        wasmInstance.ocr_get_bounding_boxes(boxesPtr);
        const boxData = new Int32Array(wasmInstance.memory.buffer, boxesPtr, boxCount * 4);

        for (let i = 0; i < boxCount; i++) {
            const x = boxData[i * 4];
            const y = boxData[i * 4 + 1];
            const w = boxData[i * 4 + 2];
            const h = boxData[i * 4 + 3];

            wasmInstance.ar_draw_bounding_box(rgbaPtr, width, height, x, y, w, h, 255, 0, 0);
        }
    }

    const outData = new Uint8ClampedArray(wasmInstance.memory.buffer, rgbaPtr, data.length);
    ctx.putImageData(new ImageData(outData, width, height), 0, 0);
}

self.onmessage = async (event) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        await initWasm();
    } else if (type === 'SET_CANVAS') {
        canvas = payload.canvas;
        ctx = canvas.getContext('2d');
    } else if (type === 'PROCESS_FRAME') {
        if (!ctx || !canvas) return;
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        processFrame(imgData, payload.profile);
        const bitmap = canvas.transferToImageBitmap();
        self.postMessage({ type: 'FRAME_PROCESSED', bitmap }, [bitmap]);
    }
};

initWasm();

export {};
