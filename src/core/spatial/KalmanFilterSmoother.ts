/**
 * KalmanFilterSmoother.ts
 * Implements a discrete Kalman filter to predict and correct user position, eliminating signal noise and jitter.
 * Optimized for 2D indoor navigation with constant velocity assumption.
 */

export interface KalmanState {
    x: number;
    y: number;
    vx: number;
    vy: number;
}

export interface KalmanCovariance {
    pxx: number;
    pxy: number;
    pyx: number;
    pyy: number;
}

export interface KalmanFilterOptions {
    processNoise?: number;
    measurementNoise?: number;
    dt?: number;
    adaptive?: boolean;
    windowSize?: number;
    minMeasurementNoise?: number;
    maxMeasurementNoise?: number;
}

export class KalmanFilterSmoother {
    private state: KalmanState;
    private covariance: KalmanCovariance;
    private processNoise: number;
    private baseMeasurementNoise: number;
    private currentMeasurementNoise: number;
    private dt: number;
    private adaptive: boolean;
    private windowSize: number;
    private minMeasurementNoise: number;
    private maxMeasurementNoise: number;
    private innovationHistoryX: number[] = [];
    private innovationHistoryY: number[] = [];

    constructor(
        initialX: number,
        initialY: number,
        processNoiseOrOptions: number | KalmanFilterOptions = 0.1,
        measurementNoise: number = 1.0,
        dt: number = 1.0
    ) {
        this.state = { x: initialX, y: initialY, vx: 0, vy: 0 };
        this.covariance = { pxx: 1, pxy: 0, pyx: 0, pyy: 1 };

        if (typeof processNoiseOrOptions === 'object' && processNoiseOrOptions !== null) {
            const opts = processNoiseOrOptions;
            this.processNoise = opts.processNoise ?? 0.1;
            this.baseMeasurementNoise = opts.measurementNoise ?? 1.0;
            this.currentMeasurementNoise = this.baseMeasurementNoise;
            this.dt = opts.dt ?? 1.0;
            this.adaptive = opts.adaptive ?? true;
            this.windowSize = opts.windowSize ?? 5;
            this.minMeasurementNoise = opts.minMeasurementNoise ?? 0.1;
            this.maxMeasurementNoise = opts.maxMeasurementNoise ?? 50.0;
        } else {
            this.processNoise = processNoiseOrOptions;
            this.baseMeasurementNoise = measurementNoise;
            this.currentMeasurementNoise = measurementNoise;
            this.dt = dt;
            this.adaptive = true;
            this.windowSize = 5;
            this.minMeasurementNoise = 0.1;
            this.maxMeasurementNoise = 50.0;
        }
    }

    public predict(): void {
        this.state.x += this.state.vx * this.dt;
        this.state.y += this.state.vy * this.dt;

        this.covariance.pxx += this.processNoise;
        this.covariance.pyy += this.processNoise;
    }

    public update(measuredX: number, measuredY: number): KalmanState {
        const innovationX = measuredX - this.state.x;
        const innovationY = measuredY - this.state.y;

        // Innovation-based adaptive estimation (IAE)
        if (this.adaptive) {
            this.innovationHistoryX.push(innovationX);
            this.innovationHistoryY.push(innovationY);

            if (this.innovationHistoryX.length > this.windowSize) {
                this.innovationHistoryX.shift();
                this.innovationHistoryY.shift();
            }

            if (this.innovationHistoryX.length >= 2) {
                const n = this.innovationHistoryX.length;
                let sumSqX = 0;
                let sumSqY = 0;
                for (let i = 0; i < n; i++) {
                    sumSqX += this.innovationHistoryX[i] * this.innovationHistoryX[i];
                    sumSqY += this.innovationHistoryY[i] * this.innovationHistoryY[i];
                }

                // Sample innovation variance C0_k = 1/N * sum(d_j^2)
                const sampleVarX = sumSqX / n;
                const sampleVarY = sumSqY / n;
                const avgSampleVar = (sampleVarX + sampleVarY) / 2;

                // Theoretical residual innovation variance is H P H' + R = P + R
                // IAE estimate of R: R_adaptive = max(C0 - H P H', R_min)
                const avgPriorCov = (this.covariance.pxx + this.covariance.pyy) / 2;
                const estimatedR = avgSampleVar - avgPriorCov;

                // Smooth adaptation to avoid chattering
                const targetR = Math.max(
                    this.minMeasurementNoise,
                    Math.min(this.maxMeasurementNoise, Math.max(this.baseMeasurementNoise, estimatedR))
                );

                const alpha = 0.3; // exponential smoothing factor
                this.currentMeasurementNoise = (1 - alpha) * this.currentMeasurementNoise + alpha * targetR;
            }
        }

        const effectiveR = this.currentMeasurementNoise;
        const innovationCovarianceX = this.covariance.pxx + effectiveR;
        const innovationCovarianceY = this.covariance.pyy + effectiveR;

        const kalmanGainX = this.covariance.pxx / innovationCovarianceX;
        const kalmanGainY = this.covariance.pyy / innovationCovarianceY;

        this.state.x += kalmanGainX * innovationX;
        this.state.y += kalmanGainY * innovationY;

        this.state.vx = (kalmanGainX * innovationX) / this.dt;
        this.state.vy = (kalmanGainY * innovationY) / this.dt;

        // Joseph's stabilized covariance form: P = (I - KH)P(I - KH)' + KRK'
        const oneMinusKx = 1 - kalmanGainX;
        const oneMinusKy = 1 - kalmanGainY;
        this.covariance.pxx = Math.max(1e-6, oneMinusKx * this.covariance.pxx * oneMinusKx + kalmanGainX * effectiveR * kalmanGainX);
        this.covariance.pyy = Math.max(1e-6, oneMinusKy * this.covariance.pyy * oneMinusKy + kalmanGainY * effectiveR * kalmanGainY);

        return { ...this.state };
    }

    public getState(): KalmanState {
        return { ...this.state };
    }

    public getMeasurementNoise(): number {
        return this.currentMeasurementNoise;
    }

    public reset(x: number, y: number): void {
        this.state = { x, y, vx: 0, vy: 0 };
        this.covariance = { pxx: 1, pxy: 0, pyx: 0, pyy: 1 };
        this.currentMeasurementNoise = this.baseMeasurementNoise;
        this.innovationHistoryX = [];
        this.innovationHistoryY = [];
    }
}
