/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { PoseLandmark, StrainMetrics } from '../core/webgl/ErgonomicAvatarRenderer';

interface WorkerMessage {
    type: 'PROCESS_FRAME' | 'CALIBRATE';
    payload: any;
}

interface WorkerResponse {
    type: 'POSE_DATA' | 'STRAIN_METRICS' | 'ERROR';
    payload: any;
}

// Simulated MediaPipe Pose Landmark processing
// In a real implementation, this would load the WASM/TFLite model
let baselineNeckAngle: number = 0;
let baselineShoulderY: number = 0;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    try {
        if (type === 'PROCESS_FRAME') {
            processFrame(payload.imageData, payload.timestamp);
        } else if (type === 'CALIBRATE') {
            calibrateBaseline(payload.landmarks);
        }
    } catch (error: any) {
        self.postMessage({ type: 'ERROR', payload: { message: error.message } } as WorkerResponse);
    }
};

function processFrame(imageData: ImageData, timestamp: number): void {
    // Simulate heavy CV processing delay
    const landmarks = simulatePoseEstimation(imageData);
    const metrics = calculateStrainMetrics(landmarks);

    self.postMessage({
        type: 'POSE_DATA',
        payload: { landmarks, timestamp }
    } as WorkerResponse);

    self.postMessage({
        type: 'STRAIN_METRICS',
        payload: { metrics, timestamp }
    } as WorkerResponse);
}

function simulatePoseEstimation(imageData: ImageData): PoseLandmark[] {
    // Generates 33 mock BlazePose landmarks for testing the renderer
    const landmarks: PoseLandmark[] = [];
    for (let i = 0; i < 33; i++) {
        landmarks.push({
            x: 0.5 + (Math.random() * 0.4 - 0.2),
            y: 0.5 + (Math.random() * 0.8 - 0.4),
            z: Math.random() * 0.1,
            visibility: 0.8 + Math.random() * 0.2
        });
    }
    return landmarks;
}

function calculateStrainMetrics(landmarks: PoseLandmark[]): StrainMetrics {
    // Head/Nose (index 0), Left Shoulder (11), Right Shoulder (12), Left Hip (23), Right Hip (24)
    const nose = landmarks[0];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    // Calculate Neck Angle (forward head posture)
    const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
    const dx = nose.x - shoulderMidX;
    const dy = nose.y - shoulderMidY;
    const neckAngle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Calculate Shoulder Asymmetry
    const shoulderDiff = Math.abs(leftShoulder.y - rightShoulder.y) * 100; // Scale to degrees approx

    // Calculate Lumbar Curvature (slouching)
    const hipMidY = (leftHip.y + rightHip.y) / 2;
    const lumbarCurvature = Math.abs(shoulderMidY - hipMidY) * 100;

    return {
        neckAngle: Math.abs(neckAngle - baselineNeckAngle),
        shoulderAsymmetry: shoulderDiff,
        lumbarCurvature
    };
}

function calibrateBaseline(landmarks: PoseLandmark[]): void {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    baselineShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    baselineNeckAngle = 0; // Assume upright during calibration
    console.log('[PoseWorker] Baseline calibrated');
}
