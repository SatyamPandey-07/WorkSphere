/**
 * PredictiveOrientation.ts
 * Implements predictive quaternion extrapolation using gyroscope angular velocity
 * to eliminate visual overshoot and lag during rapid device rotation in AR environments.
 */

export interface OrientationData {
    alpha: number; // Z-axis rotation (0 to 360)
    beta: number;  // X-axis rotation (-180 to 180)
    gamma: number; // Y-axis rotation (-90 to 90)
    rotationRate?: {
        alpha: number | null;
        beta: number | null;
        gamma: number | null;
    };
    timestamp: number;
}

export class PredictiveOrientation {
    private currentQuaternion: number[];
    private targetQuaternion: number[];
    private lastTimestamp: number;
    private smoothingFactor: number;

    constructor(smoothingFactor: number = 0.15) {
        this.currentQuaternion = [0, 0, 0, 1]; // [x, y, z, w]
        this.targetQuaternion = [0, 0, 0, 1];
        this.lastTimestamp = 0;
        this.smoothingFactor = smoothingFactor;
    }

    /**
     * Updates the target orientation and applies predictive extrapolation based on angular velocity.
     */
    public update(data: OrientationData): number[] {
        const now = data.timestamp;
        const dt = this.lastTimestamp === 0 ? 0.016 : (now - this.lastTimestamp) / 1000;
        this.lastTimestamp = now;

        // Convert Euler angles to quaternion
        const targetQ = this.eulerToQuaternion(data.alpha, data.beta, data.gamma);
        this.targetQuaternion = targetQ;

        // Apply predictive extrapolation if rotation rate is available
        let predictedQ = targetQ;
        if (data.rotationRate && data.rotationRate.alpha !== null) {
            const rateX = (data.rotationRate.beta || 0) * (Math.PI / 180);
            const rateY = (data.rotationRate.gamma || 0) * (Math.PI / 180);
            const rateZ = (data.rotationRate.alpha || 0) * (Math.PI / 180);

            // Extrapolate quaternion by angular velocity * prediction horizon (e.g., 50ms)
            const predictionHorizon = 0.05;
            predictedQ = this.extrapolateQuaternion(targetQ, rateX, rateY, rateZ, predictionHorizon);
        }

        // Spherical linear interpolation (slerp) for smooth damping
        this.currentQuaternion = this.slerp(this.currentQuaternion, predictedQ, this.smoothingFactor);

        return this.currentQuaternion;
    }

    private eulerToQuaternion(alpha: number, beta: number, gamma: number): number[] {
        const z = alpha * (Math.PI / 180) * 0.5;
        const x = beta * (Math.PI / 180) * 0.5;
        const y = gamma * (Math.PI / 180) * 0.5;

        const cz = Math.cos(z);
        const sz = Math.sin(z);
        const cx = Math.cos(x);
        const sx = Math.sin(x);
        const cy = Math.cos(y);
        const sy = Math.sin(y);

        return [
            sx * cy * cz - cx * sy * sz,
            cx * sy * cz + sx * cy * sz,
            cx * cy * sz - sx * sy * cz,
            cx * cy * cz + sx * sy * sz,
        ];
    }

    private extrapolateQuaternion(q: number[], wx: number, wy: number, wz: number, dt: number): number[] {
        const halfDt = dt * 0.5;
        const dq = [
            q[3] * wx * halfDt + q[1] * wz * halfDt - q[2] * wy * halfDt,
            q[3] * wy * halfDt + q[2] * wx * halfDt - q[0] * wz * halfDt,
            q[3] * wz * halfDt + q[0] * wy * halfDt - q[1] * wx * halfDt,
            -q[0] * wx * halfDt - q[1] * wy * halfDt - q[2] * wz * halfDt,
        ];

        let result = [
            q[0] + dq[0],
            q[1] + dq[1],
            q[2] + dq[2],
            q[3] + dq[3],
        ];

        // Normalize the resulting quaternion
        const len = Math.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2);
        return len > 0 ? result.map(v => v / len) : q;
    }

    private slerp(q1: number[], q2: number[], t: number): number[] {
        let dot = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
        let q2Adj = [...q2];

        if (dot < 0) {
            dot = -dot;
            q2Adj = q2Adj.map(v => -v);
        }

        if (dot > 0.9995) {
            // Linear interpolation for very close quaternions
            const result = [
                q1[0] + t * (q2Adj[0] - q1[0]),
                q1[1] + t * (q2Adj[1] - q1[1]),
                q1[2] + t * (q2Adj[2] - q1[2]),
                q1[3] + t * (q2Adj[3] - q1[3]),
            ];
            const len = Math.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2);
            return result.map(v => v / len);
        }

        const theta0 = Math.acos(dot);
        const theta = theta0 * t;
        const sinTheta = Math.sin(theta);
        const sinTheta0 = Math.sin(theta0);

        const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
        const s1 = sinTheta / sinTheta0;

        return [
            s0 * q1[0] + s1 * q2Adj[0],
            s0 * q1[1] + s1 * q2Adj[1],
            s0 * q1[2] + s1 * q2Adj[2],
            s0 * q1[3] + s1 * q2Adj[3],
        ];
    }

    public reset(): void {
        this.currentQuaternion = [0, 0, 0, 1];
        this.targetQuaternion = [0, 0, 0, 1];
        this.lastTimestamp = 0;
    }
}
