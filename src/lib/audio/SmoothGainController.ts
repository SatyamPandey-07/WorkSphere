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

    constructor(param: AudioParam, options: SmoothGainOptions = {}) {
        this.param = param;
        this.timeConstant = options.timeConstant ?? 0.02;
        this.minGain = options.minGain ?? -60;
        this.maxGain = options.maxGain ?? 12;
        this.currentValue = param.value;
        this.isRamping = false;
    }

    /**
     * Smoothly transitions the gain to the target value using exponential ramping.
     * @param targetValue The desired gain value in decibels.
     */
    public setGain(targetValue: number): void {
        const clampedValue = Math.max(this.minGain, Math.min(this.maxGain, targetValue));

        if (Math.abs(this.currentValue - clampedValue) < 0.01) {
            return; // Prevent unnecessary updates for negligible changes
        }

        const context = this.param.context;
        const currentTime = context.currentTime;

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

        // Reset ramping flag after the time constant has effectively passed
        setTimeout(() => {
            this.isRamping = false;
        }, this.timeConstant * 1000 * 3);
    }

    /**
     * Immediately sets the gain without smoothing. Use only for initialization.
     */
    public setGainImmediate(value: number): void {
        this.currentValue = Math.max(this.minGain, Math.min(this.maxGain, value));
        this.param.cancelScheduledValues(this.param.context.currentTime);
        this.param.setValueAtTime(this.currentValue, this.param.context.currentTime);
    }

    public getCurrentValue(): number {
        return this.currentValue;
    }

    public isCurrentlyRamping(): boolean {
        return this.isRamping;
    }
}
