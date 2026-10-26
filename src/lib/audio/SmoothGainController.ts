/**
 * SmoothGainController.ts
 * Manages smooth transitions for Web Audio API AudioParam instances to prevent 
 * audible clicking and popping artifacts caused by discontinuous waveform jumps.
 */

export interface SmoothGainOptions {
    timeConstant?: number; // Time constant in seconds for exponential ramp (default: 0.02)
    minGain?: number;      // Minimum allowed gain value (default: -60)
    maxGain?: number;      // Maximum allowed gain value (default: 12)
}

export class SmoothGainController {
    private param: AudioParam;
    private timeConstant: number;
    private minGain: number;
    private maxGain: number;
    private currentValue: number;
    private isRamping: boolean;
    private rampTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(param: AudioParam, options: SmoothGainOptions = {}) {
        this.param = param;
        const rawMin = Number.isFinite(options.minGain) ? (options.minGain as number) : -60;
        const rawMax = Number.isFinite(options.maxGain) ? (options.maxGain as number) : 12;
        this.minGain = Math.min(rawMin, rawMax);
        this.maxGain = Math.max(rawMin, rawMax);

        const rawTc = options.timeConstant;
        this.timeConstant = Number.isFinite(rawTc) && (rawTc as number) >= 0.001 ? (rawTc as number) : 0.02;

        const initialVal = Number.isFinite(param?.value) ? param.value : 0;
        this.currentValue = Math.max(this.minGain, Math.min(this.maxGain, initialVal));
        this.isRamping = false;
    }

    /**
     * Smoothly transitions the gain to the target value using exponential ramping.
     * @param targetValue The desired gain value in decibels.
     */
    public setGain(targetValue: number): void {
        if (!Number.isFinite(targetValue)) {
            return;
        }

        const clampedValue = Math.max(this.minGain, Math.min(this.maxGain, targetValue));

        if (Math.abs(this.currentValue - clampedValue) < 0.01) {
            return; // Prevent unnecessary updates for negligible changes
        }

        const context = this.param.context;
        if (!context || (context as any).state === "closed") {
            return;
        }

        const currentTime = Number.isFinite(context.currentTime) ? context.currentTime : 0;

        // Cancel any scheduled values to prevent queue buildup during rapid slider dragging
        this.param.cancelScheduledValues(currentTime);

        // Set the current value as the starting point for the ramp
        this.param.setValueAtTime(this.currentValue, currentTime);

        // Apply exponential ramp for smooth, artifact-free transition
        // Adding a small epsilon to targetValue to prevent Math.log(0) issues in Web Audio
        const safeTarget = clampedValue === -60 ? -59.999 : clampedValue;
        this.param.setTargetAtTime(safeTarget, currentTime, this.timeConstant);

        this.currentValue = clampedValue;
        this.isRamping = true;

        if (this.rampTimer) {
            clearTimeout(this.rampTimer);
        }

        // Reset ramping flag after the time constant has effectively passed (3 time constants = 95% target)
        this.rampTimer = setTimeout(() => {
            this.isRamping = false;
            this.rampTimer = null;
        }, this.timeConstant * 1000 * 3);
        this.rampTimer?.unref?.();
    }

    /**
     * Immediately sets the gain without smoothing. Use only for initialization.
     */
    public setGainImmediate(value: number): void {
        if (!Number.isFinite(value)) {
            return;
        }

        const context = this.param.context;
        if (!context || (context as any).state === "closed") {
            return;
        }

        if (this.rampTimer) {
            clearTimeout(this.rampTimer);
            this.rampTimer = null;
        }

        this.currentValue = Math.max(this.minGain, Math.min(this.maxGain, value));
        const currentTime = Number.isFinite(context.currentTime) ? context.currentTime : 0;
        this.param.cancelScheduledValues(currentTime);
        this.param.setValueAtTime(this.currentValue, currentTime);
        this.isRamping = false;
    }

    public getCurrentValue(): number {
        return this.currentValue;
    }

    public isCurrentlyRamping(): boolean {
        return this.isRamping;
    }

    public getTimeConstant(): number {
        return this.timeConstant;
    }

    public getMinGain(): number {
        return this.minGain;
    }

    public getMaxGain(): number {
        return this.maxGain;
    }

    public dispose(): void {
        if (this.rampTimer) {
            clearTimeout(this.rampTimer);
            this.rampTimer = null;
        }
        this.isRamping = false;
    }
}
