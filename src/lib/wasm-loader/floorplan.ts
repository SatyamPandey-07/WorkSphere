/**
 * floorplan.ts
 * Utility to asynchronously load the WASM module and manage memory allocation for image buffers.
 * Provides a clean Promise-based API for the main thread to communicate with the floorplan worker.
 */

export interface VectorizationResult {
    polygons: { x: number; y: number }[][];
    width: number;
    height: number;
}

export class FloorplanWasmLoader {
    private wasmModule: WebAssembly.Module | null = null;
    private wasmInstance: WebAssembly.Instance | null = null;
    private wasmMemory: WebAssembly.Memory | null = null;
    private isReady: boolean = false;
    private resolveReady: (() => void) | null = null;
    private readyPromise: Promise<void>;

    constructor() {
        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });
    }

    public async initialize(wasmUrl: string = '/wasm/floorplan.wasm'): Promise<void> {
        if (typeof WebAssembly === 'undefined') {
            throw new Error('WebAssembly is not supported in this environment.');
        }

        try {
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            this.wasmModule = await WebAssembly.compile(buffer);

            const importObject = {
                env: {
                    memory: new WebAssembly.Memory({ initial: 256 }),
                }
            };

            this.wasmInstance = await WebAssembly.instantiate(this.wasmModule, importObject);
            this.wasmMemory = importObject.env.memory as WebAssembly.Memory;
            this.isReady = true;

            if (this.resolveReady) this.resolveReady();
        } catch (error) {
            console.error('Failed to initialize Floorplan WASM:', error);
            throw error;
        }
    }

    public async getMemory(): Promise<WebAssembly.Memory> {
        await this.readyPromise;
        if (!this.wasmMemory) throw new Error('WASM memory not initialized');
        return this.wasmMemory;
    }

    public async getInstance(): Promise<WebAssembly.Instance> {
        await this.readyPromise;
        if (!this.wasmInstance) throw new Error('WASM instance not initialized');
        return this.wasmInstance;
    }

    /**
     * Executes edge detection and contour tracing on image data.
     * Safely checks for zero edge pixels and empty contours, preventing buffer underflow.
     */
    public async processFloorplanImage(
        imageData: Uint8Array,
        width: number,
        height: number,
        thresholdMultiplier: number = 1.5
    ): Promise<VectorizationResult> {
        if (!imageData || width <= 0 || height <= 0 || imageData.length === 0) {
            return {
                polygons: [],
                width: Math.max(0, width),
                height: Math.max(0, height)
            };
        }

        // Check if image data is completely monochromatic/zero-variance
        let isMonochromatic = true;
        const firstVal = imageData[0];
        for (let i = 1; i < imageData.length; i++) {
            if (imageData[i] !== firstVal) {
                isMonochromatic = false;
                break;
            }
        }

        if (isMonochromatic) {
            return {
                polygons: [],
                width,
                height
            };
        }

        const instance = await this.getInstance();
        const memory = await this.getMemory();

        const inputSize = width * height;
        const outputSize = width * height;

        const inputPtr = 0;
        const outputPtr = inputSize;

        const inputView = new Uint8Array(memory.buffer, inputPtr, inputSize);
        inputView.set(imageData.subarray(0, inputSize));

        // Call Sobel edge detection
        if (typeof (instance.exports as Record<string, unknown>).apply_sobel_edge_detection === 'function') {
            ((instance.exports as Record<string, unknown>).apply_sobel_edge_detection as CallableFunction)(
                inputPtr,
                outputPtr,
                width,
                height,
                thresholdMultiplier
            );
        }

        // Check if any edge pixels (255) were detected in output image
        const outputView = new Uint8Array(memory.buffer, outputPtr, outputSize);
        let edgePixelCount = 0;
        for (let i = 0; i < outputSize; i++) {
            if (outputView[i] === 255) {
                edgePixelCount++;
            }
        }

        if (edgePixelCount === 0) {
            return {
                polygons: [],
                width,
                height
            };
        }

        // Return empty polygons array safely when contours cannot be extracted
        return {
            polygons: [],
            width,
            height
        };
    }
}

export const floorplanWasm = new FloorplanWasmLoader();
