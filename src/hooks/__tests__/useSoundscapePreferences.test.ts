import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_SOUNDSCAPE_PREFERENCES,
  SOUNDSCAPE_PREFERENCES_STORAGE_KEY,
  clampSoundLayerVolume,
  loadSoundscapePreferences,
  saveSoundscapePreferences,
  useSoundscapePreferences,
  validateSoundscapePreferences,
} from '../useSoundscapePreferences';

describe('useSoundscapePreferences Hook & Helpers', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    jest.useFakeTimers();
    mockStorage = {};

    const storageMock: Storage = {
      getItem: jest.fn((key: string) => mockStorage[key] ?? null),
      setItem: jest.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: jest.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: jest.fn(() => {
        mockStorage = {};
      }),
      key: jest.fn((i: number) => Object.keys(mockStorage)[i] ?? null),
      length: 0,
    };

    Object.defineProperty(window, 'localStorage', {
      value: storageMock,
      writable: true,
    });
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  describe('Validation and Helpers', () => {
    it('clamps volume values correctly within [0, 100]', () => {
      expect(clampSoundLayerVolume(50)).toBe(50);
      expect(clampSoundLayerVolume(0)).toBe(0);
      expect(clampSoundLayerVolume(100)).toBe(100);
      expect(clampSoundLayerVolume(-10)).toBe(0);
      expect(clampSoundLayerVolume(150)).toBe(100);
      expect(clampSoundLayerVolume(NaN, 50)).toBe(50);
      expect(clampSoundLayerVolume('invalid', 50)).toBe(50);
      expect(clampSoundLayerVolume(null, 50)).toBe(50);
    });

    it('falls back to defaults when validating malformed data', () => {
      expect(validateSoundscapePreferences(null)).toEqual(DEFAULT_SOUNDSCAPE_PREFERENCES);
      expect(validateSoundscapePreferences(undefined)).toEqual(DEFAULT_SOUNDSCAPE_PREFERENCES);
      expect(validateSoundscapePreferences('not an object')).toEqual(DEFAULT_SOUNDSCAPE_PREFERENCES);

      // Partially valid object
      const partial = validateSoundscapePreferences({ brown: 80 });
      expect(partial.brown).toBe(80);
      expect(partial.cafe).toBe(DEFAULT_SOUNDSCAPE_PREFERENCES.cafe);
      expect(partial.rain).toBe(DEFAULT_SOUNDSCAPE_PREFERENCES.rain);
    });

    it('safely handles corrupted JSON in localStorage', () => {
      window.localStorage.setItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY, '{invalid json');
      const loaded = loadSoundscapePreferences();
      expect(loaded).toEqual(DEFAULT_SOUNDSCAPE_PREFERENCES);
    });

    it('safely handles QuotaExceededError in saveSoundscapePreferences', () => {
      const throwingStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      } as unknown as Storage;

      const success = saveSoundscapePreferences(DEFAULT_SOUNDSCAPE_PREFERENCES, 'key', throwingStorage);
      expect(success).toBe(false);
    });
  });

  describe('useSoundscapePreferences Hook Behavior', () => {
    it('initializes with default volume values when no saved preferences exist', () => {
      const { result } = renderHook(() => useSoundscapePreferences());
      expect(result.current.preferences.brown).toBe(50);
      expect(result.current.preferences.cafe).toBe(50);
      expect(result.current.preferences.rain).toBe(50);
    });

    it('restores saved volume values on initialization', () => {
      const saved = { brown: 30, cafe: 70, rain: 90 };
      window.localStorage.setItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY, JSON.stringify(saved));

      const { result } = renderHook(() => useSoundscapePreferences());
      expect(result.current.preferences.brown).toBe(30);
      expect(result.current.preferences.cafe).toBe(70);
      expect(result.current.preferences.rain).toBe(90);
    });

    it('maintains independent volumes for each sound layer', () => {
      const { result } = renderHook(() => useSoundscapePreferences());

      act(() => {
        result.current.setLayerVolume('brown', 25);
      });
      expect(result.current.preferences.brown).toBe(25);
      expect(result.current.preferences.cafe).toBe(50);
      expect(result.current.preferences.rain).toBe(50);

      act(() => {
        result.current.setLayerVolume('cafe', 85);
      });
      expect(result.current.preferences.brown).toBe(25);
      expect(result.current.preferences.cafe).toBe(85);
      expect(result.current.preferences.rain).toBe(50);

      act(() => {
        result.current.setLayerVolume('rain', 60);
      });
      expect(result.current.preferences.brown).toBe(25);
      expect(result.current.preferences.cafe).toBe(85);
      expect(result.current.preferences.rain).toBe(60);
    });

    it('slider updates immediately update in-memory preferences', () => {
      const { result } = renderHook(() => useSoundscapePreferences());

      // Immediate in-memory update without advancing timers
      act(() => {
        result.current.setLayerVolume('brown', 75);
      });
      expect(result.current.preferences.brown).toBe(75);

      // Storage is not yet written before debounce period
      expect(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)).toBeNull();
    });

    it('debounces localStorage writes by exactly 300ms', () => {
      const { result } = renderHook(() => useSoundscapePreferences());

      act(() => {
        result.current.setLayerVolume('rain', 80);
      });

      // At 299ms, nothing is written yet
      act(() => {
        jest.advanceTimersByTime(299);
      });
      expect(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)).toBeNull();

      // At 300ms, write occurs
      act(() => {
        jest.advanceTimersByTime(1);
      });

      const written = JSON.parse(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)!);
      expect(written.rain).toBe(80);
    });

    it('rapid slider changes persist only the latest values', () => {
      const { result } = renderHook(() => useSoundscapePreferences());

      act(() => {
        result.current.setLayerVolume('brown', 10);
      });
      act(() => {
        jest.advanceTimersByTime(100);
      });

      act(() => {
        result.current.setLayerVolume('brown', 20);
      });
      act(() => {
        jest.advanceTimersByTime(150);
      });

      act(() => {
        result.current.setLayerVolume('brown', 42);
      });
      act(() => {
        jest.advanceTimersByTime(299);
      });
      // Still pending after 299ms from the last update
      expect(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)).toBeNull();

      act(() => {
        jest.advanceTimersByTime(1);
      });
      const written = JSON.parse(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)!);
      expect(written.brown).toBe(42);
    });

    it('cleans up pending timers on unmount without crashing', () => {
      const { result, unmount } = renderHook(() => useSoundscapePreferences());

      act(() => {
        result.current.setLayerVolume('cafe', 95);
      });

      unmount();

      // Advancing timer after unmount should not cause issues or overwrite
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)).toBeNull();
    });

    it('handles localStorage quota exceptions gracefully without crashing the hook', () => {
      const setItemSpy = jest.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const { result } = renderHook(() => useSoundscapePreferences());

      expect(() => {
        act(() => {
          result.current.setLayerVolume('brown', 35);
        });
        act(() => {
          jest.advanceTimersByTime(300);
        });
      }).not.toThrow();

      // In-memory state remains fully functional
      expect(result.current.preferences.brown).toBe(35);

      setItemSpy.mockRestore();
    });

    it('clamps negative or out-of-range slider updates safely', () => {
      const { result } = renderHook(() => useSoundscapePreferences());

      act(() => {
        result.current.setLayerVolume('brown', -50);
        result.current.setLayerVolume('rain', 250);
      });

      expect(result.current.preferences.brown).toBe(0);
      expect(result.current.preferences.rain).toBe(100);

      act(() => {
        jest.advanceTimersByTime(300);
      });

      const written = JSON.parse(window.localStorage.getItem(SOUNDSCAPE_PREFERENCES_STORAGE_KEY)!);
      expect(written.brown).toBe(0);
      expect(written.rain).toBe(100);
    });

    it('supports alias layer names (brownNoise, cafeChatter, rainfall)', () => {
      const { result } = renderHook(() => useSoundscapePreferences());

      act(() => {
        result.current.setLayerVolume('brownNoise', 65);
        result.current.setLayerVolume('cafeChatter', 45);
        result.current.setLayerVolume('rainfall', 85);
      });

      expect(result.current.preferences.brown).toBe(65);
      expect(result.current.preferences.cafe).toBe(45);
      expect(result.current.preferences.rain).toBe(85);
    });
  });
});
