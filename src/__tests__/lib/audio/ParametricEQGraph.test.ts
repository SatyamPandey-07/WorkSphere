/**
 * ParametricEQGraph.test.ts
 * Unit tests for the ParametricEQGraph class.
 */

import { ParametricEQGraph, EQ_BOUNDS } from '@/lib/audio/ParametricEQGraph';

describe('ParametricEQGraph', () => {
    let mockContext: jest.Mocked<AudioContext>;
    let mockInput: jest.Mocked<AudioNode>;
    let mockOutput: jest.Mocked<AudioNode>;
    let mockAnalyser: jest.Mocked<AnalyserNode>;
    let filterNodes: jest.Mocked<BiquadFilterNode>[];

    beforeEach(() => {
        filterNodes = [];

        mockAnalyser = {
            fftSize: 2048,
            frequencyBinCount: 1024,
            connect: jest.fn(),
            disconnect: jest.fn(),
        } as unknown as jest.Mocked<AnalyserNode>;

        const createMockFilter = (type: BiquadFilterType = 'peaking') => {
            const node = {
                type,
                frequency: { value: 1000, setTargetAtTime: jest.fn() } as any,
                Q: { value: 1, setTargetAtTime: jest.fn() } as any,
                gain: { value: 0, setTargetAtTime: jest.fn() } as any,
                connect: jest.fn(),
                disconnect: jest.fn(),
                getFrequencyResponse: jest.fn((freqs: Float32Array, mag: Float32Array) => {
                    // Default unity gain (linear 1.0)
                    mag.fill(1.0);
                }),
            } as unknown as jest.Mocked<BiquadFilterNode>;
            filterNodes.push(node);
            return node;
        };

        mockContext = {
            createAnalyser: jest.fn().mockReturnValue(mockAnalyser),
            createBiquadFilter: jest.fn(() => createMockFilter()),
            currentTime: 0,
            sampleRate: 48000,
        } as unknown as jest.Mocked<AudioContext>;

        mockInput = { connect: jest.fn(), disconnect: jest.fn() } as unknown as jest.Mocked<AudioNode>;
        mockOutput = { connect: jest.fn(), disconnect: jest.fn() } as unknown as jest.Mocked<AudioNode>;
    });

    it('should initialize with 5 bands', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        expect(eq.bands.length).toBe(5);
        expect(eq.bands[0].type).toBe('lowshelf');
        expect(eq.bands[1].type).toBe('peaking');
        expect(eq.bands[2].type).toBe('peaking');
        expect(eq.bands[3].type).toBe('peaking');
        expect(eq.bands[4].type).toBe('highshelf');
        expect(eq.getAnalyser()).toBe(mockAnalyser);
    });

    it('should throw if AudioContext is missing', () => {
        expect(() => new ParametricEQGraph(null as any, mockInput, mockOutput)).toThrow(
            "ParametricEQGraph requires a valid AudioContext"
        );
    });

    it('should apply vocal clarity preset correctly', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        eq.applyPreset('vocal_clarity');

        const midBand = eq.getBand('mid');
        const highMidBand = eq.getBand('highMid');
        expect(midBand?.gain).toBe(4);
        expect(highMidBand?.gain).toBe(2);
        expect(midBand?.node?.gain.setTargetAtTime).toHaveBeenCalledWith(4, 0, 0.02);
        expect(highMidBand?.node?.gain.setTargetAtTime).toHaveBeenCalledWith(2, 0, 0.02);
    });

    it('should apply chatter suppression preset correctly', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        eq.applyPreset('chatter_suppression');

        const lowMidBand = eq.getBand('lowMid');
        const midBand = eq.getBand('mid');
        expect(lowMidBand?.gain).toBe(-3);
        expect(midBand?.gain).toBe(-2);
        expect(lowMidBand?.node?.gain.setTargetAtTime).toHaveBeenCalledWith(-3, 0, 0.02);
        expect(midBand?.node?.gain.setTargetAtTime).toHaveBeenCalledWith(-2, 0, 0.02);
    });

    it('should apply bass boost and treble boost presets correctly', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        eq.applyPreset('bass_boost');
        expect(eq.getBand('low')?.gain).toBe(5);
        expect(eq.getBand('lowMid')?.gain).toBe(2.5);

        eq.applyPreset('treble_boost');
        expect(eq.getBand('highMid')?.gain).toBe(2.5);
        expect(eq.getBand('high')?.gain).toBe(5);
    });

    it('should apply acoustic warmth and fallback to flat on unknown preset', () => {
        const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
        eq.applyPreset('acoustic_warmth');
        expect(eq.getBand('lowMid')?.gain).toBe(2);
        expect(eq.getBand('high')?.gain).toBe(-2);

        eq.applyPreset('unknown_preset_slug');
        eq.bands.forEach((band) => {
            expect(band.gain).toBe(0);
        });
    });

    describe('setBandGain parameter hardening', () => {
        it('clamps gain within bounds [-24, 24]', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
            eq.setBandGain('mid', 50);
            expect(eq.getBand('mid')?.gain).toBe(EQ_BOUNDS.MAX_GAIN_DB);

            eq.setBandGain('mid', -100);
            expect(eq.getBand('mid')?.gain).toBe(EQ_BOUNDS.MIN_GAIN_DB);
        });

        it('falls back to 0 when gain is NaN or non-finite', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
            eq.setBandGain('mid', NaN);
            expect(eq.getBand('mid')?.gain).toBe(0);

            eq.setBandGain('mid', Infinity);
            expect(eq.getBand('mid')?.gain).toBe(0);
        });
    });

    describe('setBandFrequency parameter hardening', () => {
        it('clamps frequency within [20, Nyquist]', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
            eq.setBandFrequency('mid', 5);
            expect(eq.getBand('mid')?.frequency).toBe(EQ_BOUNDS.MIN_FREQ_HZ);

            eq.setBandFrequency('mid', 99999);
            expect(eq.getBand('mid')?.frequency).toBe(22050);
        });

        it('preserves existing frequency when given NaN or non-finite', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
            const prevFreq = eq.getBand('mid')!.frequency;
            eq.setBandFrequency('mid', NaN);
            expect(eq.getBand('mid')?.frequency).toBe(prevFreq);
        });
    });

    describe('setBandQ parameter hardening', () => {
        it('clamps Q factor within [0.1, 18.0]', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
            eq.setBandQ('mid', 0.01);
            expect(eq.getBand('mid')?.q).toBe(EQ_BOUNDS.MIN_Q);

            eq.setBandQ('mid', 50);
            expect(eq.getBand('mid')?.q).toBe(EQ_BOUNDS.MAX_Q);
        });

        it('falls back to default Q when given non-positive or NaN', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
            eq.setBandQ('mid', -5);
            expect(eq.getBand('mid')?.q).toBe(1);

            eq.setBandQ('mid', NaN);
            expect(eq.getBand('mid')?.q).toBe(1);
        });
    });

    describe('getFrequencyResponse calculation', () => {
        it('evaluates cumulative cascade response across all 5 bands', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);

            // Mock each band contributing a 1.2 linear gain
            filterNodes.forEach((node) => {
                node.getFrequencyResponse = jest.fn((freqs, mag) => {
                    mag.fill(1.2);
                });
            });

            const { frequencies, magnitudes } = eq.getFrequencyResponse();

            expect(frequencies.length).toBe(1024);
            expect(frequencies[0]).toBeGreaterThan(20);
            expect(frequencies[frequencies.length - 1]).toBeCloseTo(24000);

            // 5 filters each providing 1.2 -> 1.2^5 = 2.48832
            expect(magnitudes[0]).toBeCloseTo(Math.pow(1.2, 5), 3);
            filterNodes.forEach((node) => {
                expect(node.getFrequencyResponse).toHaveBeenCalled();
            });
        });

        it('accepts and evaluates custom test frequency array', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
            const customFreqs = new Float32Array([100, 1000, 5000, 10000]);

            const { frequencies, magnitudes } = eq.getFrequencyResponse(customFreqs);

            expect(frequencies.length).toBe(4);
            expect(frequencies[1]).toBe(1000);
            expect(magnitudes.length).toBe(4);
        });
    });

    describe('lifecycle and disconnect', () => {
        it('should disconnect all nodes on cleanup and avoid throwing on repeated disconnect', () => {
            const eq = new ParametricEQGraph(mockContext, mockInput, mockOutput);
            expect(eq.isClosed()).toBe(false);

            eq.disconnect();
            expect(eq.isClosed()).toBe(true);

            expect(mockInput.disconnect).toHaveBeenCalled();
            expect(mockAnalyser.disconnect).toHaveBeenCalled();
            filterNodes.forEach((node) => {
                expect(node.disconnect).toHaveBeenCalled();
            });

            // Calling disconnect second time should be a safe no-op
            expect(() => eq.disconnect()).not.toThrow();
        });
    });
});
