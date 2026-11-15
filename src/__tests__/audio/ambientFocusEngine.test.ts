import {
  AmbientAudioSynthesizer,
  type SoundTrackState,
} from '@/lib/audio/ambientFocusEngine';

describe('AmbientAudioSynthesizer (ambientFocusEngine.ts)', () => {
  let mockContext: any;
  let mockDestination: any;
  let mockGainNodes: any[];
  let mockSourceNodes: any[];
  let mockPannerNodes: any[];
  let mockBiquadNodes: any[];
  let mockOscillators: any[];

  beforeEach(() => {
    mockGainNodes = [];
    mockSourceNodes = [];
    mockPannerNodes = [];
    mockBiquadNodes = [];
    mockOscillators = [];

    mockDestination = { connect: jest.fn(), disconnect: jest.fn() };

    mockContext = {
      state: 'running',
      currentTime: 10,
      sampleRate: 48000,
      destination: mockDestination,
      resume: jest.fn().mockResolvedValue(undefined),
      createBuffer: jest.fn((channels, length, rate) => ({
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        getChannelData: jest.fn(() => new Float32Array(length)),
      })),
      createBufferSource: jest.fn(() => {
        const source = {
          buffer: null,
          loop: false,
          connect: jest.fn(),
          disconnect: jest.fn(),
          start: jest.fn(),
          stop: jest.fn(),
        };
        mockSourceNodes.push(source);
        return source;
      }),
      createBiquadFilter: jest.fn(() => {
        const filter = {
          type: 'lowpass',
          frequency: { setValueAtTime: jest.fn(), value: 800 },
          connect: jest.fn(),
          disconnect: jest.fn(),
        };
        mockBiquadNodes.push(filter);
        return filter;
      }),
      createStereoPanner: jest.fn(() => {
        const panner = {
          pan: { setValueAtTime: jest.fn(), value: 0 },
          connect: jest.fn(),
          disconnect: jest.fn(),
        };
        mockPannerNodes.push(panner);
        return panner;
      }),
      createGain: jest.fn(() => {
        const gain = {
          gain: {
            setValueAtTime: jest.fn(),
            exponentialRampToValueAtTime: jest.fn(),
            value: 1,
          },
          connect: jest.fn(),
          disconnect: jest.fn(),
        };
        mockGainNodes.push(gain);
        return gain;
      }),
      createOscillator: jest.fn(() => {
        const osc = {
          type: 'sine',
          frequency: {
            setValueAtTime: jest.fn(),
            exponentialRampToValueAtTime: jest.fn(),
          },
          connect: jest.fn(),
          disconnect: jest.fn(),
          start: jest.fn(),
          stop: jest.fn(),
          onended: null,
        };
        mockOscillators.push(osc);
        return osc;
      }),
    };
  });

  it('resumes audio context if suspended when initialized', () => {
    mockContext.state = 'suspended';
    const synth = new AmbientAudioSynthesizer(mockContext);
    synth.init();
    expect(mockContext.resume).toHaveBeenCalled();
  });

  describe('playTrack and audio buffer generation', () => {
    it('creates and connects noise nodes for rain track', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.playTrack('rain', 0.8, -0.5);

      expect(mockContext.createBuffer).toHaveBeenCalledWith(1, 96000, 48000);
      expect(mockSourceNodes.length).toBe(1);
      expect(mockSourceNodes[0].loop).toBe(true);
      expect(mockSourceNodes[0].start).toHaveBeenCalled();

      expect(mockBiquadNodes[0].type).toBe('lowpass');
      expect(mockPannerNodes[0].pan.setValueAtTime).toHaveBeenCalledWith(-0.5, 10);
      // Volume 0.8 * 0.3 = 0.24
      expect(mockGainNodes[0].gain.setValueAtTime).toHaveBeenCalledWith(0.8 * 0.3, 10);

      expect(synth.isPlaying('rain')).toBe(true);
      expect(synth.getPlayingTracks()).toEqual(['rain']);
    });

    it('clamps volume within [0, 1] and pan within [-1, 1]', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.playTrack('cafe', 2.0, 5.0); // volume > 1, pan > 1

      expect(mockPannerNodes[0].pan.setValueAtTime).toHaveBeenCalledWith(1.0, 10);
      // Clamped to 1.0 * 0.3 = 0.3
      expect(mockGainNodes[0].gain.setValueAtTime).toHaveBeenCalledWith(0.3, 10);
    });

    it('falls back to safe defaults when volume or pan are NaN', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.playTrack('binaural', NaN, NaN);

      // Default pan is 0 (center), default volume is 0.5 * 0.3 = 0.15
      expect(mockPannerNodes[0].pan.setValueAtTime).toHaveBeenCalledWith(0, 10);
      expect(mockGainNodes[0].gain.setValueAtTime).toHaveBeenCalledWith(0.15, 10);
    });

    it('updates existing track volume and pan without creating duplicate nodes', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.playTrack('rain', 0.5, 0);
      expect(mockSourceNodes.length).toBe(1);

      synth.playTrack('rain', 0.9, 0.4);
      expect(mockSourceNodes.length).toBe(1); // No new source created
      expect(mockGainNodes[0].gain.setValueAtTime).toHaveBeenCalledWith(0.9 * 0.3, 10);
      expect(mockPannerNodes[0].pan.setValueAtTime).toHaveBeenCalledWith(0.4, 10);
    });
  });

  describe('stopTrack node cleanup and leak prevention', () => {
    it('stops the source node, disconnects the chain, and removes the track', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.playTrack('vinyl', 0.6, 0);

      const source = mockSourceNodes[0];
      const filter = mockBiquadNodes[0];
      const panner = mockPannerNodes[0];
      const gain = mockGainNodes[0];

      synth.stopTrack('vinyl');

      expect(source.stop).toHaveBeenCalled();
      expect(source.disconnect).toHaveBeenCalled();
      expect(filter.disconnect).toHaveBeenCalled();
      expect(panner.disconnect).toHaveBeenCalled();
      expect(gain.disconnect).toHaveBeenCalled();

      expect(synth.isPlaying('vinyl')).toBe(false);
      expect(synth.getPlayingTracks()).toEqual([]);
    });

    it('safely handles stopping a non-existent track without throwing', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      expect(() => synth.stopTrack('whitenoise')).not.toThrow();
    });
  });

  describe('setMuted volume preservation', () => {
    it('silences all tracks when muted and restores configured volume on unmute', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.playTrack('rain', 1.0, 0); // target gain = 0.30
      synth.playTrack('cafe', 0.2, 0); // target gain = 0.06

      expect(synth.isAudioMuted()).toBe(false);

      synth.setMuted(true);
      expect(synth.isAudioMuted()).toBe(true);
      expect(mockGainNodes[0].gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
      expect(mockGainNodes[1].gain.setValueAtTime).toHaveBeenCalledWith(0, 10);

      synth.setMuted(false);
      expect(synth.isAudioMuted()).toBe(false);
      // Must restore individual configured gains (not forced 0.15)
      expect(mockGainNodes[0].gain.setValueAtTime).toHaveBeenCalledWith(1.0 * 0.3, 10);
      expect(mockGainNodes[1].gain.setValueAtTime).toHaveBeenCalledWith(0.2 * 0.3, 10);
    });
  });

  describe('playChime and Pomodoro transition sound', () => {
    it('generates acoustic sine chime with exponential frequency and decay', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.playChime();

      expect(mockOscillators.length).toBe(1);
      const osc = mockOscillators[0];
      expect(osc.start).toHaveBeenCalled();
      expect(osc.stop).toHaveBeenCalledWith(11.8);
      expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(587.33, 10);
    });

    it('does not play chime when muted', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.setMuted(true);
      synth.playChime();
      expect(mockOscillators.length).toBe(0);
    });
  });

  describe('dispose lifecycle', () => {
    it('stops all playing tracks and clears active nodes', () => {
      const synth = new AmbientAudioSynthesizer(mockContext);
      synth.playTrack('rain', 0.5, 0);
      synth.playTrack('cafe', 0.5, 0);

      expect(synth.getPlayingTracks().length).toBe(2);

      synth.dispose();

      expect(mockSourceNodes[0].stop).toHaveBeenCalled();
      expect(mockSourceNodes[1].stop).toHaveBeenCalled();
      expect(synth.getPlayingTracks().length).toBe(0);
    });
  });
});
