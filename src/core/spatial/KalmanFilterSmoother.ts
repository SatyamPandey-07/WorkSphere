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

export class KalmanFilterSmoother {
    private state: KalmanState;
    private covariance: KalmanCovariance;
    private processNoise: number;
    private measurementNoise: number;
    private dt: number;

    constructor(initialX: number, initialY: number, processNoise: number = 0.1, measurementNoise: number = 1.0, dt: number = 1.0) {
        this.state = { x: initialX, y: initialY, vx: 0, vy: 0 };
        this.covariance = { pxx: 1, pxy: 0, pyx: 0, pyy: 1 };
        this.processNoise = processNoise;
        this.measurementNoise = measurementNoise;
        this.dt = dt;
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

        const innovationCovarianceX = this.covariance.pxx + this.measurementNoise;
        const innovationCovarianceY = this.covariance.pyy + this.measurementNoise;

        const kalmanGainX = this.covariance.pxx / innovationCovarianceX;
        const kalmanGainY = this.covariance.pyy / innovationCovarianceY;

        this.state.x += kalmanGainX * innovationX;
        this.state.y += kalmanGainY * innovationY;

        this.state.vx = (this.state.x - (this.state.x - kalmanGainX * innovationX)) / this.dt;
        this.state.vy = (this.state.y - (this.state.y - kalmanGainY * innovationY)) / this.dt;

        this.covariance.pxx = (1 - kalmanGainX) * this.covariance.pxx;
        this.covariance.pyy = (1 - kalmanGainY) * this.covariance.pyy;

        return { ...this.state };
    }

    public getState(): KalmanState {
        return { ...this.state };
    }

    public reset(x: number, y: number): void {
        this.state = { x, y, vx: 0, vy: 0 };
        this.covariance = { pxx: 1, pxy: 0, pyx: 0, pyy: 1 };
    }
}
