/**
 * ParametricEQGraph.ts
 * Constructs a connected Web Audio API graph linking 5 BiquadFilterNodes 
 * (LowShelf, Peaking Low-Mid, Peaking Mid, Peaking High-Mid, HighShelf) 
 * with real-time frequency curve visualization data.
 */

export interface EQBand {
    id: string;
    type: BiquadFilterType;
    frequency: number;
    q: number;
    gain: number;
    node: BiquadFilterNode | null;
}

export class ParametricEQGraph {
    public bands: EQBand[];
    private context: AudioContext;
    private inputNode: AudioNode;
    private outputNode: AudioNode;
    private analyser: AnalyserNode;

    constructor(context: AudioContext, input: AudioNode, output: AudioNode) {
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

            currentNode.connect(filter);
            currentNode = filter;
        });

        currentNode.connect(this.analyser);
        this.analyser.connect(this.outputNode);
    }

    public setBandGain(bandId: string, gain: number): void {
        const band = this.bands.find((b) => b.id === bandId);
        if (band && band.node) {
            band.gain = gain;
            band.node.gain.setTargetAtTime(gain, this.context.currentTime, 0.02);
        }
    }

    public setBandFrequency(bandId: string, frequency: number): void {
        const band = this.bands.find((b) => b.id === bandId);
        if (band && band.node) {
            band.frequency = frequency;
            band.node.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.02);
        }
    }

    public setBandQ(bandId: string, q: number): void {
        const band = this.bands.find((b) => b.id === bandId);
        if (band && band.node) {
            band.q = q;
            band.node.Q.setTargetAtTime(q, this.context.currentTime, 0.02);
        }
    }

    public applyPreset(preset: 'vocal_clarity' | 'chatter_suppression' | 'flat'): void {
        this.bands.forEach((band) => {
            if (preset === 'flat') {
                this.setBandGain(band.id, 0);
            } else if (preset === 'vocal_clarity') {
                if (band.id === 'mid') this.setBandGain(band.id, 4);
                else if (band.id === 'highMid') this.setBandGain(band.id, 2);
                else this.setBandGain(band.id, 0);
            } else if (preset === 'chatter_suppression') {
                if (band.id === 'lowMid') this.setBandGain(band.id, -3);
                else if (band.id === 'mid') this.setBandGain(band.id, -2);
                else this.setBandGain(band.id, 0);
            }
        });
    }

    public getFrequencyResponse(): { frequencies: Float32Array; magnitudes: Float32Array } {
        const frequencies = new Float32Array(this.analyser.frequencyBinCount);
        const magnitudes = new Float32Array(this.analyser.frequencyBinCount);

        // We use the last band's node to get the cumulative response of the chain
        const lastBand = this.bands[this.bands.length - 1].node;
        if (lastBand) {
            lastBand.getFrequencyResponse(frequencies, magnitudes, new Float32Array(frequencies.length));
        }

        return { frequencies, magnitudes };
    }

    public getAnalyser(): AnalyserNode {
        return this.analyser;
    }

    public disconnect(): void {
        this.bands.forEach((band) => {
            if (band.node) band.node.disconnect();
        });
        this.analyser.disconnect();
    }
}
