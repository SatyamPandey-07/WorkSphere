/**
 * ParametricEQGraph.ts
 * Constructs a connected Web Audio API graph linking 5 BiquadFilterNodes 
 * (LowShelf, Peaking Low-Mid, Peaking Mid, Peaking High-Mid, HighShelf) 
 * with real-time frequency curve visualization data and cascaded frequency response.
 */

export interface EQBand {
    id: string;
    type: BiquadFilterType;
    frequency: number;
    q: number;
    gain: number;
    node: BiquadFilterNode | null;
}

export type EQPresetType =
    | 'vocal_clarity'
    | 'chatter_suppression'
    | 'flat'
    | 'bass_boost'
    | 'treble_boost'
    | 'acoustic_warmth';

export const EQ_BOUNDS = {
    MIN_GAIN_DB: -24,
    MAX_GAIN_DB: 24,
    MIN_FREQ_HZ: 20,
    MAX_FREQ_HZ: 22050,
    MIN_Q: 0.1,
    MAX_Q: 18.0,
    DEFAULT_SAMPLE_RATE: 48000,
} as const;

export class ParametricEQGraph {
    public bands: EQBand[];
    private context: AudioContext;
    private inputNode: AudioNode;
    private outputNode: AudioNode;
    private analyser: AnalyserNode;
    private isDisconnected: boolean = false;

    constructor(context: AudioContext, input: AudioNode, output: AudioNode) {
        if (!context) {
            throw new Error("ParametricEQGraph requires a valid AudioContext");
        }
        this.context = context;
        this.inputNode = input;
        this.outputNode = output;

        this.analyser = context.createAnalyser();
        this.analyser.fftSize = 2048;

        this.bands = [
            { id: 'low', type: 'lowshelf', frequency: 100, q: 1, gain: 0, node: null },
            { id: 'lowMid', type: 'peaking', frequency: 300, q: 1, gain: 0, node: null },
            { id: 'mid', type: 'peaking', frequency: 1000, q: 1, gain: 0, node: null },
            { id: 'highMid', type: 'peaking', frequency: 3000, q: 1, gain: 0, node: null },
            { id: 'high', type: 'highshelf', frequency: 8000, q: 1, gain: 0, node: null },
        ];

        this.buildGraph();
    }

    private buildGraph(): void {
        let currentNode: AudioNode = this.inputNode;

        this.bands.forEach((band) => {
            const filter = this.context.createBiquadFilter();
            filter.type = band.type;
            filter.frequency.value = band.frequency;
            filter.Q.value = band.q;
            filter.gain.value = band.gain;
            band.node = filter;

            if (currentNode && typeof currentNode.connect === 'function') {
                currentNode.connect(filter);
            }
            currentNode = filter;
        });

        if (currentNode && typeof currentNode.connect === 'function') {
            currentNode.connect(this.analyser);
        }
        if (this.outputNode && typeof this.analyser.connect === 'function') {
            this.analyser.connect(this.outputNode);
        }
    }

    public getBand(bandId: string): EQBand | undefined {
        return this.bands.find((b) => b.id === bandId);
    }

    public setBandGain(bandId: string, gain: number): void {
        const band = this.getBand(bandId);
        if (band) {
            const safeGain = Number.isFinite(gain)
                ? Math.max(EQ_BOUNDS.MIN_GAIN_DB, Math.min(EQ_BOUNDS.MAX_GAIN_DB, gain))
                : 0;
            band.gain = safeGain;
            if (band.node && band.node.gain) {
                if (typeof band.node.gain.setTargetAtTime === 'function') {
                    band.node.gain.setTargetAtTime(safeGain, this.context.currentTime, 0.02);
                } else {
                    band.node.gain.value = safeGain;
                }
            }
        }
    }

    public setBandFrequency(bandId: string, frequency: number): void {
        const band = this.getBand(bandId);
        if (band) {
            const nyquist = (this.context.sampleRate || EQ_BOUNDS.DEFAULT_SAMPLE_RATE) / 2;
            const maxFreq = Math.max(EQ_BOUNDS.MIN_FREQ_HZ, Math.min(EQ_BOUNDS.MAX_FREQ_HZ, nyquist - 1));
            const safeFreq = Number.isFinite(frequency)
                ? Math.max(EQ_BOUNDS.MIN_FREQ_HZ, Math.min(maxFreq, frequency))
                : band.frequency;
            band.frequency = safeFreq;
            if (band.node && band.node.frequency) {
                if (typeof band.node.frequency.setTargetAtTime === 'function') {
                    band.node.frequency.setTargetAtTime(safeFreq, this.context.currentTime, 0.02);
                } else {
                    band.node.frequency.value = safeFreq;
                }
            }
        }
    }

    public setBandQ(bandId: string, q: number): void {
        const band = this.getBand(bandId);
        if (band) {
            const safeQ = Number.isFinite(q) && q > 0
                ? Math.max(EQ_BOUNDS.MIN_Q, Math.min(EQ_BOUNDS.MAX_Q, q))
                : (band.q || 1);
            band.q = safeQ;
            if (band.node && band.node.Q) {
                if (typeof band.node.Q.setTargetAtTime === 'function') {
                    band.node.Q.setTargetAtTime(safeQ, this.context.currentTime, 0.02);
                } else {
                    band.node.Q.value = safeQ;
                }
            }
        }
    }

    public applyPreset(preset: EQPresetType | string): void {
        switch (preset) {
            case 'vocal_clarity':
                this.setBandGain('low', 0);
                this.setBandGain('lowMid', 0);
                this.setBandGain('mid', 4);
                this.setBandGain('highMid', 2);
                this.setBandGain('high', 0);
                break;
            case 'chatter_suppression':
                this.setBandGain('low', 0);
                this.setBandGain('lowMid', -3);
                this.setBandGain('mid', -2);
                this.setBandGain('highMid', 0);
                this.setBandGain('high', 0);
                break;
            case 'bass_boost':
                this.setBandGain('low', 5);
                this.setBandGain('lowMid', 2.5);
                this.setBandGain('mid', 0);
                this.setBandGain('highMid', 0);
                this.setBandGain('high', 0);
                break;
            case 'treble_boost':
                this.setBandGain('low', 0);
                this.setBandGain('lowMid', 0);
                this.setBandGain('mid', 0);
                this.setBandGain('highMid', 2.5);
                this.setBandGain('high', 5);
                break;
            case 'acoustic_warmth':
                this.setBandGain('low', 1);
                this.setBandGain('lowMid', 2);
                this.setBandGain('mid', 1);
                this.setBandGain('highMid', 0);
                this.setBandGain('high', -2);
                break;
            case 'flat':
            default:
                this.bands.forEach((b) => this.setBandGain(b.id, 0));
                break;
        }
    }

    /**
     * Calculates the cumulative frequency response across all cascaded equalizer bands.
     * Evaluates true magnitude response across the audible spectrum (20Hz to Nyquist)
     * by cascading each active filter's transfer function (M_total = M_1 * M_2 * ... * M_N).
     */
    public getFrequencyResponse(customFrequencies?: Float32Array): { frequencies: Float32Array; magnitudes: Float32Array } {
        const binCount = customFrequencies?.length || (this.analyser ? this.analyser.frequencyBinCount : 1024) || 1024;
        const nyquist = (this.context.sampleRate || EQ_BOUNDS.DEFAULT_SAMPLE_RATE) / 2;

        let frequencies: Float32Array;
        if (customFrequencies && customFrequencies.length > 0) {
            frequencies = new Float32Array(customFrequencies);
        } else {
            frequencies = new Float32Array(binCount);
            // Logarithmic-like linear step distribution spanning 20 Hz to Nyquist
            for (let i = 0; i < binCount; i++) {
                frequencies[i] = EQ_BOUNDS.MIN_FREQ_HZ + ((nyquist - EQ_BOUNDS.MIN_FREQ_HZ) * (i + 1)) / binCount;
            }
        }

        const magnitudes = new Float32Array(frequencies.length);
        magnitudes.fill(1.0);

        const tempMag = new Float32Array(frequencies.length);
        const tempPhase = new Float32Array(frequencies.length);

        for (const band of this.bands) {
            if (band.node && typeof band.node.getFrequencyResponse === 'function') {
                band.node.getFrequencyResponse(frequencies, tempMag, tempPhase);
                for (let i = 0; i < frequencies.length; i++) {
                    const m = Number.isFinite(tempMag[i]) ? tempMag[i] : 1.0;
                    magnitudes[i] *= m;
                }
            }
        }

        return { frequencies, magnitudes };
    }

    public getAnalyser(): AnalyserNode {
        return this.analyser;
    }

    public isClosed(): boolean {
        return this.isDisconnected;
    }

    public disconnect(): void {
        if (this.isDisconnected) return;
        this.isDisconnected = true;

        if (this.inputNode && typeof this.inputNode.disconnect === 'function') {
            try {
                this.inputNode.disconnect();
            } catch (_) {}
        }

        this.bands.forEach((band) => {
            if (band.node && typeof band.node.disconnect === 'function') {
                try {
                    band.node.disconnect();
                } catch (_) {}
            }
        });

        if (this.analyser && typeof this.analyser.disconnect === 'function') {
            try {
                this.analyser.disconnect();
            } catch (_) {}
        }
    }
}
