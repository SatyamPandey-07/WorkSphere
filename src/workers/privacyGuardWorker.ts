/**
 * privacyGuardWorker.ts
 * Web Worker that receives OffscreenCanvas frames, runs the WASM inference, 
 * and emits privacy breach events.
 */

import { loadPrivacyWasm, PrivacyWasmModule } from '../lib/wasm-loader/privacy';

export interface WorkerMessage {
    type: 'init' | 'process-frame' | 'calibrate';
    payload?: any;
}

export interface PrivacyEvent {
    type: 'shoulder-surfing-detected' | 'gaze-away' | 'status';
    severity: 'low' | 'medium' | 'high';
    timestamp: number;
    data?: any;
}

class PrivacyGuard {
    private wasmModule: PrivacyWasmModule | null = null;
    private isCalibrated: boolean = false;
    private sensitivityThreshold: number = 0.6;

    async init() {
        try {
            this.wasmModule = await loadPrivacyWasm();
            this.postMessage({
                type: 'status',
                severity: 'low',
                timestamp: Date.now(),
                data: { message: 'WASM module loaded successfully' },
            });
        } catch (err) {
            console.error('[Privacy Worker] Failed to load WASM:', err);
        }
    }

    async processFrame(imageData: ImageData) {
        if (!this.wasmModule) return;

        // In a real scenario, we'd pass the raw RGBA buffer to WASM.
        // Here we simulate passing a downsampled grayscale array.
        const width = imageData.width;
        const height = imageData.height;

        // Downsample and convert to grayscale for performance
        const grayBuffer = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const r = imageData.data[i * 4];
            const g = imageData.data[i * 4 + 1];
            const b = imageData.data[i * 4 + 2];
            grayBuffer[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        }

        // Call WASM gaze tracking
        const gazeResult = this.wasmModule.processGazeFrame(grayBuffer, width, height);

        if (gazeResult.success) {
            if (!gazeResult.isLookingAtScreen) {
                this.postMessage({
                    type: 'gaze-away',
                    severity: 'low',
                    timestamp: Date.now(),
                    data: { yaw: gazeResult.yaw, pitch: gazeResult.pitch },
                });
            }
        }

        // Simulate face detection data for shoulder surfing
        // Format: [x, y, bbox_height, yaw] per face
        const mockFaceData = new Float32Array([
            width / 2, height / 2, 100, 0, // Primary user
            width / 2 + 150, height / 2 - 50, 80, -0.2, // Secondary face (looking at screen)
        ]);

        const surfDetected = this.wasmModule.detectShoulderSurfing(mockFaceData, 2, 0);

        if (surfDetected) {
            this.postMessage({
                type: 'shoulder-surfing-detected',
                severity: 'high',
                timestamp: Date.now(),
                data: { message: 'Secondary face looking at screen' },
            });
        }
    }

    calibrate(threshold: number) {
        this.sensitivityThreshold = threshold;
        this.isCalibrated = true;
        console.log(`[Privacy Worker] Calibrated with threshold: ${threshold}`);
    }

    private postMessage(event: PrivacyEvent) {
        self.postMessage(event);
    }
}

const guard = new PrivacyGuard();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    if (type === 'init') {
        await guard.init();
    } else if (type === 'process-frame') {
        await guard.processFrame(payload as ImageData);
    } else if (type === 'calibrate') {
        guard.calibrate(payload.threshold);
    }
};

self.postMessage({ type: 'worker-ready' });
