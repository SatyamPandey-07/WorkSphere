/**
 * SmoothGainController.test.ts
 * Unit tests for the SmoothGainController to ensure artifact-free audio transitions.
 */

import { SmoothGainController } from '@/lib/audio/SmoothGainController';

describe('SmoothGainController', () => {
    let mockAudioParam: jest.Mocked<AudioParam>;
    let mockContext: jest.Mocked<AudioContext>;

    beforeEach(() => {
        mockContext = {
            currentTime: 10.0,
        } as unknown as jest.Mocked<AudioContext>;

        mockAudioParam = {
            context: mockContext,
            value: 0,
            setValueAtTime: jest.fn(),
            setTargetAtTime: jest.fn(),
            cancelScheduledValues: jest.fn(),
        } as unknown as jest.Mocked<AudioParam>;
    });

    it('should initialize with the current param value', () => {
        mockAudioParam.value = 5;
        const controller = new SmoothGainController(mockAudioParam);
        expect(controller.getCurrentValue()).toBe(5);
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
});
