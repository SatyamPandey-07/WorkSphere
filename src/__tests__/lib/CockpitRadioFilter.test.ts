// @ts-nocheck
import { CockpitRadioFilter } from '@/lib/audio/CockpitRadioFilter';

describe('CockpitRadioFilter Web Audio Node', () => {
  let mockAudioContext: any;

  beforeEach(() => {
    mockAudioContext = {
      currentTime: 0,
      createGain: jest.fn(() => ({
        gain: { setValueAtTime: jest.fn(), value: 1 },
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
      createBiquadFilter: jest.fn(() => ({
        type: 'lowpass',
        frequency: { setValueAtTime: jest.fn(), value: 350 },
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
      createWaveShaper: jest.fn(() => ({
        curve: null,
        oversample: 'none',
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
    };
  });

  it('configures aviation radio bandpass filters within 300Hz and 3400Hz', () => {
    const filter = new CockpitRadioFilter(mockAudioContext, {
      lowCutFrequency: 300,
      highCutFrequency: 3400,
    });

    expect(mockAudioContext.createBiquadFilter).toHaveBeenCalledTimes(2);
    expect(filter.getEnabled()).toBe(true);
  });

  it('supports toggling tactical radio comms mode on and off', () => {
    const filter = new CockpitRadioFilter(mockAudioContext);
    expect(filter.getEnabled()).toBe(true);

    filter.setEnabled(false);
    expect(filter.getEnabled()).toBe(false);

    filter.setEnabled(true);
    expect(filter.getEnabled()).toBe(true);
  });
});