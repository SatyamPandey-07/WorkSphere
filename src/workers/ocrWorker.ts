/**
 * ocrWorker.ts
 * Web Worker that processes the image buffer through the WASM pipeline and outputs raw text coordinates.
 */

export interface OcrProcessingOptions {
    enhanceContrast?: boolean;
    useClahe?: boolean;
    clipLimit?: number;
    tileGridSize?: number;
}

/**
 * Applies Contrast Limited Adaptive Histogram Equalization (CLAHE) on grayscale pixels.
 * Enhances local contrast across grid tiles while limiting noise amplification via clipLimit.
 */
export function applyCLAHE(
    grayscale: Uint8Array,
    width: number,
    height: number,
    clipLimit: number = 3.0,
    gridSize: number = 8
): Uint8Array {
    const output = new Uint8Array(grayscale.length);
    const tilesX = Math.max(1, Math.floor(width / gridSize));
    const tilesY = Math.max(1, Math.floor(height / gridSize));

    // Compute CDF for each tile
    const cdfs: Float32Array[] = [];

    for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
            const startX = Math.floor((tx * width) / tilesX);
            const endX = Math.floor(((tx + 1) * width) / tilesX);
            const startY = Math.floor((ty * height) / tilesY);
            const endY = Math.floor(((ty + 1) * height) / tilesY);
            const tilePixelCount = (endX - startX) * (endY - startY);

            // 256-bin histogram
            const hist = new Uint32Array(256);
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    hist[grayscale[y * width + x]]++;
                }
            }

            // Clip histogram
            const clipThreshold = Math.max(1, Math.floor((clipLimit * tilePixelCount) / 256));
            let excess = 0;
            for (let i = 0; i < 256; i++) {
                if (hist[i] > clipThreshold) {
                    excess += hist[i] - clipThreshold;
                    hist[i] = clipThreshold;
                }
            }

            // Redistribute excess evenly
            const bonus = Math.floor(excess / 256);
            const remainder = excess % 256;
            for (let i = 0; i < 256; i++) {
                hist[i] += bonus + (i < remainder ? 1 : 0);
            }

            // Compute normalized Cumulative Distribution Function (CDF)
            const cdf = new Float32Array(256);
            let sum = 0;
            for (let i = 0; i < 256; i++) {
                sum += hist[i];
                cdf[i] = (sum / tilePixelCount) * 255.0;
            }
            cdfs.push(cdf);
        }
    }

    // Bilinear interpolation across tile grid centroids
    for (let y = 0; y < height; y++) {
        const normY = ((y + 0.5) / height) * tilesY - 0.5;
        const ty1 = Math.max(0, Math.min(tilesY - 1, Math.floor(normY)));
        const ty2 = Math.max(0, Math.min(tilesY - 1, ty1 + 1));
        const dy = Math.max(0, Math.min(1, normY - ty1));

        for (let x = 0; x < width; x++) {
            const normX = ((x + 0.5) / width) * tilesX - 0.5;
            const tx1 = Math.max(0, Math.min(tilesX - 1, Math.floor(normX)));
            const tx2 = Math.max(0, Math.min(tilesX - 1, tx1 + 1));
            const dx = Math.max(0, Math.min(1, normX - tx1));

            const val = grayscale[y * width + x];

            const cdfTL = cdfs[ty1 * tilesX + tx1][val];
            const cdfTR = cdfs[ty1 * tilesX + tx2][val];
            const cdfBL = cdfs[ty2 * tilesX + tx1][val];
            const cdfBR = cdfs[ty2 * tilesX + tx2][val];

            const top = cdfTL * (1 - dx) + cdfTR * dx;
            const bottom = cdfBL * (1 - dx) + cdfBR * dx;
            const interpolated = top * (1 - dy) + bottom * dy;

            output[y * width + x] = Math.max(0, Math.min(255, Math.round(interpolated)));
        }
    }

    return output;
}

/**
 * Global contrast stretching (min-max normalization) to expand dynamic range.
 */
export function applyContrastStretch(grayscale: Uint8Array): Uint8Array {
    let min = 255;
    let max = 0;
    for (let i = 0; i < grayscale.length; i++) {
        if (grayscale[i] < min) min = grayscale[i];
        if (grayscale[i] > max) max = grayscale[i];
    }

    if (max <= min) {
        return new Uint8Array(grayscale);
    }

    const output = new Uint8Array(grayscale.length);
    const range = max - min;
    for (let i = 0; i < grayscale.length; i++) {
        output[i] = Math.round(((grayscale[i] - min) / range) * 255);
    }
    return output;
}

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'PROCESS_IMAGE') {
        try {
            const {
                imageData,
                width,
                height,
                wasmUrl,
                options = {}
            } = payload as {
                imageData: Uint8ClampedArray | Uint8Array;
                width: number;
                height: number;
                wasmUrl: string;
                options?: OcrProcessingOptions;
            };

            // Initialize WASM (mocked for scaffold)
            const response = await fetch(wasmUrl);
            const buffer = await response.arrayBuffer();
            const module = await WebAssembly.compile(buffer);

            const importObject = { env: { memory: new WebAssembly.Memory({ initial: 256 }) } };
            const instance = await WebAssembly.instantiate(module, importObject);
            const memory = importObject.env.memory as WebAssembly.Memory;

            // Copy image data to WASM
            const pixelCount = width * height;
            let grayscale = new Uint8Array(pixelCount);
            for (let i = 0; i < pixelCount; i++) {
                const r = imageData[i * 4];
                const g = imageData[i * 4 + 1];
                const b = imageData[i * 4 + 2];
                grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            }

            // Pre-processing filter: Adaptive Histogram Equalization (CLAHE) / Contrast Stretching
            const shouldEnhanceContrast = options.enhanceContrast !== false; // Enabled by default or on toggle
            if (shouldEnhanceContrast) {
                if (options.useClahe !== false) {
                    grayscale = applyCLAHE(
                        grayscale,
                        width,
                        height,
                        options.clipLimit ?? 3.0,
                        options.tileGridSize ?? 8
                    );
                } else {
                    grayscale = applyContrastStretch(grayscale);
                }
            }

            const imgPtr = 0;
            const binPtr = pixelCount;

            const imgView = new Uint8Array(memory.buffer, imgPtr, pixelCount);
            imgView.set(grayscale);

            // Run pipeline
            (instance.exports.apply_median_filter as CallableFunction)(imgPtr, width, height);
            (instance.exports.apply_otsu_threshold as CallableFunction)(imgPtr, binPtr, width, height);

            // Mock segmentation result
            const mockBoxes = [
                { x_min: 10, y_min: 10, x_max: 50, y_max: 30 },
                { x_min: 60, y_min: 10, x_max: 100, y_max: 30 }
            ];

            self.postMessage({
                type: 'OCR_RESULT',
                payload: {
                    boxes: mockBoxes,
                    width,
                    height
                }
            });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};

/**
 * Default idle timeout duration in milliseconds (2 minutes = 120,000ms).
 */
export const DEFAULT_OCR_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

export interface WorkerInstanceLike {
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
    terminate: () => void;
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
    onmessage?: ((event: MessageEvent) => void) | null;
    onerror?: ((event: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => WorkerInstanceLike;

/**
 * Manages the lifecycle of an OCR web worker instance with automatic idle termination.
 * Automatically calls worker.terminate() when no jobs are active after the idle timeout window,
 * and transparently re-spawns the worker on subsequent requests (#5736).
 */
export class OcrWorkerManager {
    private worker: WorkerInstanceLike | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private activeJobsCount: number = 0;
    private readonly idleTimeoutMs: number;
    private readonly workerFactory: WorkerFactory;
    private onTerminatedCallback?: () => void;

    constructor(
        options: {
            idleTimeoutMs?: number;
            workerFactory?: WorkerFactory;
            onTerminated?: () => void;
        } = {}
    ) {
        this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_OCR_IDLE_TIMEOUT_MS;
        this.workerFactory =
            options.workerFactory ??
            (() => {
                if (typeof Worker !== 'undefined') {
                    return new Worker(new URL('./ocrWorker.ts', import.meta.url), {
                        type: 'module',
                    });
                }
                throw new Error('Web Workers are not supported in this environment');
            });
        this.onTerminatedCallback = options.onTerminated;
    }

    /**
     * Gets or creates the active Worker instance, resetting idle countdown.
     */
    public getOrCreateWorker(): WorkerInstanceLike {
        this.clearIdleTimer();
        if (!this.worker) {
            this.worker = this.workerFactory();
        }
        return this.worker;
    }

    /**
     * Checks if a worker instance is currently spawned and active.
     */
    public isWorkerActive(): boolean {
        return this.worker !== null;
    }

    /**
     * Increments active job counter, cancelling any scheduled idle termination.
     */
    public startJob(): WorkerInstanceLike {
        this.activeJobsCount++;
        return this.getOrCreateWorker();
    }

    /**
     * Decrements active job counter and initiates idle countdown if zero jobs remain.
     */
    public endJob(): void {
        this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
        if (this.activeJobsCount === 0) {
            this.scheduleIdleTermination();
        }
    }

    /**
     * Schedules worker termination after idle timeout elapses.
     */
    public scheduleIdleTermination(): void {
        this.clearIdleTimer();
        if (this.worker && this.activeJobsCount === 0) {
            this.idleTimer = setTimeout(() => {
                this.terminate();
            }, this.idleTimeoutMs);
        }
    }

    /**
     * Immediately terminates the active worker instance and releases resources.
     */
    public terminate(): void {
        this.clearIdleTimer();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            if (this.onTerminatedCallback) {
                this.onTerminatedCallback();
            }
        }
    }

    private clearIdleTimer(): void {
        if (this.idleTimer !== null) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * Executes an OCR image processing job, managing worker spawning and idle lifecycle.
     */
    public async processImage(payload: unknown): Promise<unknown> {
        const worker = this.startJob();

        return new Promise((resolve, reject) => {
            const handleMessage = (event: MessageEvent) => {
                const { type, payload: resPayload, error } = event.data || {};
                if (type === 'OCR_RESULT') {
                    cleanup();
                    resolve(resPayload);
                } else if (type === 'ERROR') {
                    cleanup();
                    reject(new Error(error));
                }
            };

            const handleError = (errorEvent: ErrorEvent) => {
                cleanup();
                reject(errorEvent);
            };

            const cleanup = () => {
                if (worker.removeEventListener) {
                    worker.removeEventListener('message', handleMessage as (e: unknown) => void);
                    worker.removeEventListener('error', handleError as (e: unknown) => void);
                }
                this.endJob();
            };

            if (worker.addEventListener) {
                worker.addEventListener('message', handleMessage as (e: unknown) => void);
                worker.addEventListener('error', handleError as (e: unknown) => void);
            } else {
                worker.onmessage = handleMessage;
                worker.onerror = handleError;
            }

            worker.postMessage({
                type: 'PROCESS_IMAGE',
                payload,
            });
        });
    }
}

// Global singleton instance for shared client use
let globalOcrManager: OcrWorkerManager | null = null;

export function getGlobalOcrManager(options?: { idleTimeoutMs?: number }): OcrWorkerManager {
    if (!globalOcrManager) {
        globalOcrManager = new OcrWorkerManager(options);
    }
    return globalOcrManager;
}
