/**
 * SmoothGainController.test.ts
 * Unit tests for the SmoothGainController to ensure artifact-free audio transitions.
 */

import { SmoothGainController } from '@/lib/audio/SmoothGainController';

describe('SmoothGainController', () => {
    let mockAudioParam: jest.Mocked<AudioParam>;
    let mockContext: jest.Mocked<AudioContext>;

    beforeEach(() => {
        jest.useFakeTimers();
        mockContext = {
            currentTime: 10.0,
            state: 'running',
        } as unknown as jest.Mocked<AudioContext>;

        mockAudioParam = {
            context: mockContext,
            value: 0,
            setValueAtTime: jest.fn(),
            setTargetAtTime: jest.fn(),
            cancelScheduledValues: jest.fn(),
        } as unknown as jest.Mocked<AudioParam>;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should initialize with the current param value', () => {
        mockAudioParam.value = 5;
        const controller = new SmoothGainController(mockAudioParam);
        expect(controller.getCurrentValue()).toBe(5);
        expect(controller.getTimeConstant()).toBe(0.02);
        expect(controller.getMinGain()).toBe(-60);
        expect(controller.getMaxGain()).toBe(12);
    });

    it('should clamp values to min and max bounds', () => {
        const controller = new SmoothGainController(mockAudioParam, { minGain: -10, maxGain: 10 });

        controller.setGain(15);
        expect(controller.getCurrentValue()).toBe(10);
        expect(mockAudioParam.setTargetAtTime).toHaveBeenCalledWith(10, 10.0, 0.02);

        controller.setGain(-15);
        expect(controller.getCurrentValue()).toBe(-10);
        expect(mockAudioParam.setTargetAtTime).toHaveBeenCalledWith(-10, 10.0, 0.02);
    });

    it('normalizes swapped min/max bounds in options', () => {
        const controller = new SmoothGainController(mockAudioParam, { minGain: 15, maxGain: -10 });
        expect(controller.getMinGain()).toBe(-10);
        expect(controller.getMaxGain()).toBe(15);

        controller.setGain(20);
        expect(controller.getCurrentValue()).toBe(15);
    });

    it('falls back to safe timeConstant when zero, negative or NaN is passed', () => {
        const controllerZero = new SmoothGainController(mockAudioParam, { timeConstant: 0 });
        expect(controllerZero.getTimeConstant()).toBe(0.02);

        const controllerNeg = new SmoothGainController(mockAudioParam, { timeConstant: -0.5 });
        expect(controllerNeg.getTimeConstant()).toBe(0.02);

        const controllerNaN = new SmoothGainController(mockAudioParam, { timeConstant: NaN });
        expect(controllerNaN.getTimeConstant()).toBe(0.02);
    });

    it('ignores non-finite target values in setGain and setGainImmediate', () => {
        const controller = new SmoothGainController(mockAudioParam);
        controller.setGain(NaN);
        controller.setGain(Infinity);
        controller.setGain(-Infinity);

        expect(mockAudioParam.setTargetAtTime).not.toHaveBeenCalled();

        controller.setGainImmediate(NaN);
        expect(mockAudioParam.setValueAtTime).not.toHaveBeenCalled();
    });

    it('should cancel scheduled values before applying a new ramp', () => {
        const controller = new SmoothGainController(mockAudioParam);
        controller.setGain(5);

        expect(mockAudioParam.cancelScheduledValues).toHaveBeenCalledWith(10.0);
        expect(mockAudioParam.setValueAtTime).toHaveBeenCalledWith(0, 10.0);
        expect(mockAudioParam.setTargetAtTime).toHaveBeenCalledWith(5, 10.0, 0.02);
    });

    it('should ignore negligible changes to prevent unnecessary updates', () => {
        const controller = new SmoothGainController(mockAudioParam);
        controller.setGain(0.005);

        expect(mockAudioParam.setTargetAtTime).not.toHaveBeenCalled();
    });

    it('should handle -60dB safely to prevent Math.log(0) errors', () => {
        const controller = new SmoothGainController(mockAudioParam, { minGain: -60 });
        controller.setGain(-60);

        expect(mockAudioParam.setTargetAtTime).toHaveBeenCalledWith(-59.999, 10.0, 0.02);
    });

    it('manages isRamping state and replaces timer on rapid consecutive ramps', () => {
        const controller = new SmoothGainController(mockAudioParam, { timeConstant: 0.05 });
        expect(controller.isCurrentlyRamping()).toBe(false);

        controller.setGain(5);
        expect(controller.isCurrentlyRamping()).toBe(true);

        // Advance 100ms (not yet 150ms)
        jest.advanceTimersByTime(100);
        expect(controller.isCurrentlyRamping()).toBe(true);

        // Call again before previous timer expires - replaces timer
        controller.setGain(8);
        expect(controller.isCurrentlyRamping()).toBe(true);

        // Advance 60ms (160ms total from start, but only 60ms from second call)
        jest.advanceTimersByTime(60);
        expect(controller.isCurrentlyRamping()).toBe(true);

        // Advance remaining 90ms to complete 150ms from second call
        jest.advanceTimersByTime(90);
        expect(controller.isCurrentlyRamping()).toBe(false);
    });

    it('immediately sets gain with setGainImmediate', () => {
        const controller = new SmoothGainController(mockAudioParam);
        controller.setGainImmediate(8);

        expect(controller.getCurrentValue()).toBe(8);
        expect(mockAudioParam.setValueAtTime).toHaveBeenCalledWith(8, 10.0);
        expect(controller.isCurrentlyRamping()).toBe(false);
    });

    it('aborts safely when audio context is closed', () => {
        (mockContext as any).state = 'closed';
        const controller = new SmoothGainController(mockAudioParam);
        controller.setGain(5);

        expect(mockAudioParam.setTargetAtTime).not.toHaveBeenCalled();

        controller.setGainImmediate(5);
        expect(mockAudioParam.setValueAtTime).not.toHaveBeenCalled();
    });

    it('cancels timers and clears ramping flag on dispose()', () => {
        const controller = new SmoothGainController(mockAudioParam);
        controller.setGain(6);
        expect(controller.isCurrentlyRamping()).toBe(true);

        controller.dispose();
        expect(controller.isCurrentlyRamping()).toBe(false);

        jest.advanceTimersByTime(1000);
        expect(controller.isCurrentlyRamping()).toBe(false);
    });
});
