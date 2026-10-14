/**
 * BiometricPomodoroEngine
 * Manages the adaptive timer state machine, adjusting intervals based on real-time physiological feedback.
 */

export enum SessionPhase {
    WORK = 'WORK',
    SHORT_BREAK = 'SHORT_BREAK',
    LONG_BREAK = 'LONG_BREAK',
    IDLE = 'IDLE',
}

export interface BiometricData {
    heartRate: number;
    hrvRMSSD: number;
    timestamp: number;
}

export interface IntervalConfig {
    baseWorkDuration: number; // in ms
    baseShortBreak: number;
    baseLongBreak: number;
    sessionsUntilLongBreak: number;
}

export interface SessionState {
    phase: SessionPhase;
    currentIntervalEnd: number;
    completedWorkSessions: number;
    flowScore: number; // 0.0 to 1.0
    stressScore: number; // 0.0 to 1.0
}

export class BiometricPomodoroEngine {
    private state: SessionState;
    private config: IntervalConfig;
    private biometricBuffer: BiometricData[] = [];
    private readonly BUFFER_SIZE = 10;

    constructor(config: IntervalConfig) {
        this.config = config;
        this.state = {
            phase: SessionPhase.IDLE,
            currentIntervalEnd: 0,
            completedWorkSessions: 0,
            flowScore: 0.5,
            stressScore: 0.5,
        };
    }

    public startSession(): SessionState {
        this.state.phase = SessionPhase.WORK;
        this.state.currentIntervalEnd = Date.now() + this.calculateNextInterval();
        this.state.completedWorkSessions = 0;
        return this.getState();
    }

    public updateBiometrics(data: BiometricData): SessionState {
        this.biometricBuffer.push(data);
        if (this.biometricBuffer.length > this.BUFFER_SIZE) {
            this.biometricBuffer.shift();
        }

        this.recalculateScores();

        if (Date.now() >= this.state.currentIntervalEnd) {
            this.advancePhase();
        }

        return this.getState();
    }

    private recalculateScores(): void {
        if (this.biometricBuffer.length < 3) return;

        const recentHR = this.biometricBuffer.slice(-3).map(b => b.heartRate);
        const recentHRV = this.biometricBuffer.slice(-3).map(b => b.hrvRMSSD);

        const avgHR = recentHR.reduce((a, b) => a + b, 0) / recentHR.length;
        const avgHRV = recentHRV.reduce((a, b) => a + b, 0) / recentHRV.length;

        // Simplified heuristic scoring. High HRV + Stable HR = Flow. Low HRV + High HR = Stress.
        const hrvNorm = Math.min(avgHRV / 100, 1.0);
        const hrNorm = Math.min(avgHR / 120, 1.0);

        this.state.flowScore = hrvNorm * (1 - hrNorm * 0.5);
        this.state.stressScore = hrNorm * (1 - hrvNorm * 0.5);
    }

    private calculateNextInterval(): number {
        if (this.state.phase === SessionPhase.WORK) {
            // Extend work block if in deep flow, shorten if stressed
            const flowMultiplier = 1.0 + (this.state.flowScore * 0.5); // Up to 1.5x duration
            const stressMultiplier = 1.0 - (this.state.stressScore * 0.3); // Down to 0.7x duration
            return this.config.baseWorkDuration * flowMultiplier * stressMultiplier;
        }

        if (this.state.phase === SessionPhase.SHORT_BREAK) {
            // Extend break if stressed
            const stressExtension = 1.0 + (this.state.stressScore * 0.5);
            return this.config.baseShortBreak * stressExtension;
        }

        return this.config.baseLongBreak;
    }

    private advancePhase(): void {
        if (this.state.phase === SessionPhase.WORK) {
            this.state.completedWorkSessions++;
            if (this.state.completedWorkSessions % this.config.sessionsUntilLongBreak === 0) {
                this.state.phase = SessionPhase.LONG_BREAK;
            } else {
                this.state.phase = SessionPhase.SHORT_BREAK;
            }
        } else {
            this.state.phase = SessionPhase.WORK;
        }

        this.state.currentIntervalEnd = Date.now() + this.calculateNextInterval();
    }

    public getState(): SessionState {
        return { ...this.state };
    }
}
