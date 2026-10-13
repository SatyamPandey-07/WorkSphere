/**
 * ParametricEQGraph.test.ts
 * Unit tests for the ParametricEQGraph class.
 */

import { ParametricEQGraph } from '@/lib/audio/ParametricEQGraph';

describe('ParametricEQGraph', () => {
    let mockContext: jest.Mocked<AudioContext>;
    let mockInput: jest.Mocked<AudioNode>;
    let mockOutput: jest.Mocked<AudioNode>;
    let mockAnalyser: jest.Mocked<AnalyserNode>;
    let mockFilter: jest.Mocked<BiquadFilterNode>;

    beforeEach(() => {
        mockAnalyser = {
            fftSize: 2048,
            frequencyBinCount: 1024,
            connect: jest.fn(),
            disconnect: jest.fn(),
        } as unknown as jest.Mocked<AnalyserNode>;

        mockFilter = {
            type: 'peaking',
            frequency: { value: 1000, setTargetAtTime: jest.fn() } as any,
            Q: { value: 1, setTargetAtTime: jest.fn() } as any,
            gain: { value: 0, setTargetAtTime: jest.fn() } as any,
            connect: jest.fn(),
            disconnect: jest.fn(),
            getFrequencyResponse: jest.fn(),
        } as unknown as jest.Mocked<BiquadFilterNode>;

        mockContext = {
            createAnalyser: jest.fn().mockReturnValue(mockAnalyser),
            createBiquadFilter: jest.fn().mockReturnValue(mockFilter),
            currentTime: 0,
        } as unknown as jest.Mocked<AudioContext>;

        mockInput = { connect: jest.fn() } as unknown as jest.Mocked<AudioNode>;
        mockOutput = {} as unknown as jest.Mocked<AudioNode>;
    });

    it('should initialize with 5 bands', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        expect(eq.bands.length).toBe(5);
        expect(eq.bands[0].type).toBe('lowshelf');
        expect(eq.bands[2].type).toBe('peaking');
        expect(eq.bands[4].type).toBe('highshelf');
    });

    it('should apply vocal clarity preset correctly', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        eq.applyPreset('vocal_clarity');

        // Check that mid and highMid gains were set
        expect(mockFilter.gain.setTargetAtTime).toHaveBeenCalledWith(4, 0, 0.02);
    });

    it('should apply chatter suppression preset correctly', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        eq.applyPreset('chatter_suppression');

        expect(mockFilter.gain.setTargetAtTime).toHaveBeenCalledWith(-3, 0, 0.02);
    });

    it('should disconnect all nodes on cleanup', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        eq.disconnect();

        expect(mockAnalyser.disconnect).toHaveBeenCalled();
        expect(mockFilter.disconnect).toHaveBeenCalled();
    });
});
