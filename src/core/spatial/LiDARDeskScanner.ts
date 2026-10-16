/**
 * @file LiDARDeskScanner.ts
 * @description Interfaces with the WebXR Depth API to ingest raw depth buffers 
 * and construct a 3D spatial mesh of the desk environment. Handles coordinate 
 * transformation and point cloud generation for downstream ergonomic validation.
 */

export interface DepthFrame {
    width: number;
    height: number;
    data: Float32Array;
    projectionMatrix: Float32Array;
    viewMatrix: Float32Array;
}

export interface PointCloudPoint {
    x: number;
    y: number;
    z: number;
    confidence: number;
}

export class LiDARDeskScanner {
    private xrSession: XRSession | null = null;
    private xrRefSpace: XRReferenceSpace | null = null;
    private isScanning: boolean = false;
    private onFrameCallback: ((points: PointCloudPoint[]) => void) | null = null;

    public async checkSupport(): Promise<boolean> {
        if (!navigator.xr) return false;
        try {
            const supported = await navigator.xr.isSessionSupported('immersive-ar');
            return supported;
        } catch {
            return false;
        }
    }

    public async startScanning(onFrame: (points: PointCloudPoint[]) => void): Promise<void> {
        if (this.isScanning) return;

        this.onFrameCallback = onFrame;

        try {
            this.xrSession = await navigator.xr!.requestSession('immersive-ar', {
                requiredFeatures: ['depth-sensing'],
                depthSensing: {
                    usagePreference: ['cpu-optimized'],
                    dataFormatPreference: ['float32'],
                },
            });

            this.xrSession.addEventListener('end', () => {
                this.isScanning = false;
                this.xrSession = null;
            });

            this.xrRefSpace = await this.xrSession.requestReferenceSpace('local');
            this.xrSession.requestAnimationFrame(this.onXRFrame.bind(this));
            this.isScanning = true;
        } catch (error) {
            console.error('Failed to start XR session:', error);
            throw new Error('LiDAR/Depth sensing not available on this device');
        }
    }

    public stopScanning(): void {
        if (this.xrSession) {
            this.xrSession.end();
        }
    }

    private onXRFrame(time: number, frame: XRFrame): void {
        if (!this.xrSession || !this.xrRefSpace) return;

        this.xrSession.requestAnimationFrame(this.onXRFrame.bind(this));

        const pose = frame.getViewerPose(this.xrRefSpace);
        if (!pose) return;

        const depthInfo = frame.getDepthInformation(pose.views[0]);
        if (!depthInfo) return;

        const points = this.processDepthBuffer(depthInfo, pose.views[0]);
        if (this.onFrameCallback) {
            this.onFrameCallback(points);
        }
    }

    private processDepthBuffer(depthInfo: XRDepthInformation, view: XRView): PointCloudPoint[] {
        const points: PointCloudPoint[] = [];
        const { width, height, data } = depthInfo;
        const projMatrix = view.projectionMatrix;
        const viewMatrix = view.transform.inverse.matrix;

        for (let y = 0; y < height; y += 4) {
            for (let x = 0; x < width; x += 4) {
                const depth = depthInfo.getDepthInMeters(x, y);
                if (depth > 0.1 && depth < 3.0) {
                    const ndcX = (x / width) * 2 - 1;
                    const ndcY = (y / height) * 2 - 1;

                    const worldPos = this.unproject(ndcX, ndcY, depth, projMatrix, viewMatrix);
                    if (worldPos) {
                        points.push({
                            x: worldPos[0],
                            y: worldPos[1],
                            z: worldPos[2],
                            confidence: 1.0,
                        });
                    }
                }
            }
        }
        return points;
    }

    private unproject(ndcX: number, ndcY: number, depth: number, proj: Float32Array, view: Float32Array): [number, number, number] | null {
        const invProj = this.invertMatrix(proj);
        const invView = this.invertMatrix(view);
        if (!invProj || !invView) return null;

        const clipPos = [ndcX, ndcY, depth * 2 - 1, 1.0];
        const eyePos = this.multiplyMatrixVec4(invProj, clipPos);
        if (eyePos[3] === 0) return null;

        eyePos[0] /= eyePos[3];
        eyePos[1] /= eyePos[3];
        eyePos[2] /= eyePos[3];
        eyePos[3] = 1.0;

        const worldPos = this.multiplyMatrixVec4(invView, eyePos);
        return [worldPos[0], worldPos[1], worldPos[2]];
    }

    private invertMatrix(m: Float32Array): Float32Array | null {
        const inv = new Float32Array(16);
        inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
        inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
        inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
        inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
        inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
        inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
        inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
        inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
        inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
        inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
        inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
        inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
        inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
        inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
        inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
        inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];

        let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
        if (det === 0) return null;

        det = 1.0 / det;
        for (let i = 0; i < 16; i++) inv[i] *= det;
        return inv;
    }

    private multiplyMatrixVec4(m: Float32Array, v: number[]): number[] {
        return [
            m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
            m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
        ];
    }
}
