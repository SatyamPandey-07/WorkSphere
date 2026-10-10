/**
 * postureWorker.ts
 * Web Worker that receives OffscreenCanvas frames, runs the WASM inference, and emits posture alerts.
 * Processes video frames at ~15fps to minimize CPU overhead.
 */

import { postureWasm } from '@/lib/wasm-loader/posture';

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            await postureWasm.initialize(payload.wasmUrl);
            self.postMessage({ type: 'READY', success: true });
        } catch (error) {
            self.postMessage({ type: 'READY', success: false, error: String(error) });
        }
    }

    if (type === 'PROCESS_FRAME') {
        try {
            const { imageData, width, height } = payload; // imageData is Uint8ClampedArray (RGBA)
            const instance = await postureWasm.getInstance();
            const memory = await postureWasm.getMemory();

            // Convert RGBA to Grayscale for WASM
            const pixelCount = width * height;
            const grayscale = new Uint8Array(pixelCount);
            for (let i = 0; i < pixelCount; i++) {
                const r = imageData[i * 4];
                const g = imageData[i * 4 + 1];
                const b = imageData[i * 4 + 2];
                grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            }

            // Copy to WASM memory
            const imagePtr = 0;
            const poseResultPtr = pixelCount; // Offset for PoseResult struct
            const ergonomicReportPtr = poseResultPtr + 256; // Offset for ErgonomicReport struct

            const imageView = new Uint8Array(memory.buffer, imagePtr, pixelCount);
            imageView.set(grayscale);

            // Run pose estimation
            (instance.exports.estimate_pose as CallableFunction)(imagePtr, width, height, poseResultPtr);

            // Run ergonomic scoring
            (instance.exports.evaluate_ergonomics as CallableFunction)(
                poseResultPtr,
                (instance.exports.get_landmark_count as CallableFunction)(poseResultPtr),
                height,
                ergonomicReportPtr
            );

            // Read results from memory
            // ErgonomicReport struct: int, int, float, float, float (5 * 4 bytes = 20 bytes)
            const reportView = new DataView(memory.buffer, ergonomicReportPtr, 20);
            const isSlouching = reportView.getInt32(0, true) !== 0;
            const isTooClose = reportView.getInt32(4, true) !== 0;
            const neckAngle = reportView.getFloat32(8, true);
            const symmetry = reportView.getFloat32(12, true);
            const overallScore = reportView.getFloat32(16, true);

            self.postMessage({
                type: 'POSTURE_RESULT',
                payload: {
                    isSlouching,
                    isTooClose,
                    neckAngleDeg: neckAngle,
                    shoulderSymmetry: symmetry,
                    overallScore: overallScore,
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};
