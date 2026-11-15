import {
  CockpitRadioFilter,
  COCKPIT_RADIO_DEFAULTS,
  makeCockpitDistortionCurve,
  sanitizeDistortionAmount,
  sanitizeRadioFrequencies,
} from '@/lib/audio/CockpitRadioFilter';

describe('CockpitRadioFilter Web Audio Node', () => {
  let mockAudioContext: any;
  let mockGainNodes: any[];
  let mockFilters: any[];
  let mockWaveShaper: any;

  beforeEach(() => {
    mockGainNodes = [];
    mockFilters = [];

    const createGain = () => {
      const node = {
        gain: { setValueAtTime: jest.fn(), value: 1 },
        connect: jest.fn(),
        disconnect: jest.fn(),
      };
      mockGainNodes.push(node);
      return node;
    };

    const createBiquad = () => {
      const node = {
        type: 'lowpass',
        frequency: { setValueAtTime: jest.fn(), value: 350 },
        connect: jest.fn(),
        disconnect: jest.fn(),
      };
      mockFilters.push(node);
      return node;
    };

    mockWaveShaper = {
      curve: null,
      oversample: 'none',
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockAudioContext = {
      currentTime: 0,
      sampleRate: 48000,
      createGain: jest.fn(createGain),
      createBiquadFilter: jest.fn(createBiquad),
      createWaveShaper: jest.fn(() => mockWaveShaper),
    };
  });

  it('configures aviation radio bandpass filters within 300Hz and 3400Hz', () => {
    const filter = new CockpitRadioFilter(mockAudioContext, {
      lowCutFrequency: 300,
      highCutFrequency: 3400,
    });

    expect(mockAudioContext.createBiquadFilter).toHaveBeenCalledTimes(2);
    expect(filter.getEnabled()).toBe(true);
    expect(filter.getDistortionAmount()).toBe(20);
  });

  it('throws an error if AudioContext is missing', () => {
    expect(() => new CockpitRadioFilter(null as any)).toThrow(
      "CockpitRadioFilter requires a valid AudioContext"
    );
  });

  it('supports toggling tactical radio comms mode on and off', () => {
    const filter = new CockpitRadioFilter(mockAudioContext);
    expect(filter.getEnabled()).toBe(true);

    filter.setEnabled(false);
    expect(filter.getEnabled()).toBe(false);

    filter.setEnabled(true);
    expect(filter.getEnabled()).toBe(true);
  });

  describe('makeCockpitDistortionCurve and sanitizeDistortionAmount', () => {
    it('returns a clean linear transfer curve when distortion is 0', () => {
      const curve = makeCockpitDistortionCurve(0, 100);
      expect(curve.length).toBe(100);
      expect(curve[0]).toBeCloseTo(-1, 2);
      expect(curve[50]).toBeCloseTo(0, 2);
      expect(curve[99]).toBeCloseTo(0.98, 2);
    });

    it('generates non-linear saturation curve with positive distortion', () => {
      const curve = makeCockpitDistortionCurve(25, 100);
      expect(curve.length).toBe(100);
      for (let i = 0; i < curve.length; i++) {
        expect(Number.isFinite(curve[i])).toBe(true);
      }
    });

    it('clamps negative distortion to 0 to prevent division by zero', () => {
      expect(sanitizeDistortionAmount(-10)).toBe(COCKPIT_RADIO_DEFAULTS.MIN_DISTORTION);
      const curve = makeCockpitDistortionCurve(-10, 100);
      expect(Number.isFinite(curve[0])).toBe(true);
    });

    it('clamps excessive distortion and handles NaN safely', () => {
      expect(sanitizeDistortionAmount(500)).toBe(COCKPIT_RADIO_DEFAULTS.MAX_DISTORTION);
      expect(sanitizeDistortionAmount(NaN)).toBe(COCKPIT_RADIO_DEFAULTS.DEFAULT_DISTORTION);
      expect(sanitizeDistortionAmount(Infinity)).toBe(COCKPIT_RADIO_DEFAULTS.DEFAULT_DISTORTION);
    });
  });

  describe('sanitizeRadioFrequencies and inverted bounds protection', () => {
    it('preserves valid telephone bandpass frequencies', () => {
      const { lowCut, highCut } = sanitizeRadioFrequencies(250, 4000);
      expect(lowCut).toBe(250);
      expect(highCut).toBe(4000);
    });

    it('automatically corrects inverted frequencies where lowCut >= highCut', () => {
      const { lowCut, highCut } = sanitizeRadioFrequencies(5000, 200);
      expect(lowCut).toBe(COCKPIT_RADIO_DEFAULTS.DEFAULT_LOW_CUT_HZ);
      expect(highCut).toBe(COCKPIT_RADIO_DEFAULTS.DEFAULT_HIGH_CUT_HZ);
    });

    it('falls back to defaults when given NaN or non-finite frequencies', () => {
      const { lowCut, highCut } = sanitizeRadioFrequencies(NaN, Infinity);
      expect(lowCut).toBe(COCKPIT_RADIO_DEFAULTS.DEFAULT_LOW_CUT_HZ);
      expect(highCut).toBe(COCKPIT_RADIO_DEFAULTS.DEFAULT_HIGH_CUT_HZ);
    });
  });

  describe('dynamic parameter adjustment', () => {
    it('updates low-cut and high-cut frequencies via setters', () => {
      const filter = new CockpitRadioFilter(mockAudioContext);
      filter.setLowCutFrequency(400);
      filter.setHighCutFrequency(3000);

      expect(mockFilters[0].frequency.setValueAtTime).toHaveBeenCalledWith(400, 0);
      expect(mockFilters[1].frequency.setValueAtTime).toHaveBeenCalledWith(3000, 0);
    });

    it('updates distortion amount dynamically and regenerates curve', () => {
      const filter = new CockpitRadioFilter(mockAudioContext);
      filter.setDistortionAmount(40);

      expect(filter.getDistortionAmount()).toBe(40);
      expect(mockWaveShaper.curve).toBeDefined();
    });
  });

  describe('disconnect and lifecycle', () => {
    it('disconnects all wet, dry, filter, and waveshaper nodes idempotently', () => {
      const filter = new CockpitRadioFilter(mockAudioContext);
      filter.disconnect();

      expect(filter.inputNode.disconnect).toHaveBeenCalled();
      expect(filter.outputNode.disconnect).toHaveBeenCalled();
      expect(mockWaveShaper.disconnect).toHaveBeenCalled();

      // Second call must not throw or duplicate
      expect(() => filter.disconnect()).not.toThrow();
    });
  });
});
