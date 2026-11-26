import { renderHook, act } from '@testing-library/react';
import {
  useSearchPreferences,
  parseRadius,
  isValidRadius,
  SEARCH_RADIUS_STORAGE_KEY,
  DEFAULT_RADIUS,
} from '@/hooks/useSearchPreferences';

describe('useSearchPreferences & search radius persistence (#9890)', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  describe('radius validation & parsing', () => {
    it('validates allowed radius numbers and string inputs', () => {
      expect(isValidRadius(0)).toBe(true);
      expect(isValidRadius(1)).toBe(true);
      expect(isValidRadius(5)).toBe(true);
      expect(isValidRadius(10)).toBe(true);
      expect(isValidRadius('5')).toBe(true);
      expect(isValidRadius('10')).toBe(true);

      expect(isValidRadius(99)).toBe(false);
      expect(isValidRadius(-1)).toBe(false);
      expect(isValidRadius('invalid')).toBe(false);
      expect(isValidRadius(null)).toBe(false);
      expect(isValidRadius(undefined)).toBe(false);
    });

    it('falls back to default (5km) on unsupported or malformed values', () => {
      expect(parseRadius(99)).toBe(DEFAULT_RADIUS);
      expect(parseRadius('invalid')).toBe(DEFAULT_RADIUS);
      expect(parseRadius('')).toBe(DEFAULT_RADIUS);
      expect(parseRadius(null)).toBe(DEFAULT_RADIUS);
      expect(parseRadius(undefined)).toBe(DEFAULT_RADIUS);
      expect(parseRadius(10)).toBe(10);
      expect(parseRadius('10')).toBe(10);
    });
  });

  describe('localStorage persistence & retrieval', () => {
    it('1. saves selected radius to worksphere_search_radius when changed', () => {
      const { result } = renderHook(() => useSearchPreferences());

      act(() => {
        result.current.setRadius(10);
      });

      expect(result.current.radius).toBe(10);
      expect(localStorage.getItem(SEARCH_RADIUS_STORAGE_KEY)).toBe('10');
    });

    it('2. restores a valid saved radius on initialization', () => {
      localStorage.setItem(SEARCH_RADIUS_STORAGE_KEY, '25');

      const { result } = renderHook(() => useSearchPreferences());
      expect(result.current.radius).toBe(25);
    });

    it('3. falls back to 5km when no saved value exists', () => {
      const { result } = renderHook(() => useSearchPreferences());
      expect(result.current.radius).toBe(DEFAULT_RADIUS);
      expect(result.current.radius).toBe(5);
    });

    it('4. falls back to 5km when the saved value is invalid', () => {
      localStorage.setItem(SEARCH_RADIUS_STORAGE_KEY, 'invalid_radius');

      const { result } = renderHook(() => useSearchPreferences());
      expect(result.current.radius).toBe(5);
    });

    it('5. does not accept values outside the allowed radius options', () => {
      localStorage.setItem(SEARCH_RADIUS_STORAGE_KEY, '999');

      const { result } = renderHook(() => useSearchPreferences());
      expect(result.current.radius).toBe(5);

      act(() => {
        result.current.setRadius(77);
      });

      expect(result.current.radius).toBe(5);
      expect(localStorage.getItem(SEARCH_RADIUS_STORAGE_KEY)).toBe('5');
    });

    it('6. handles localStorage read failures safely', () => {
      const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: Access is denied');
      });

      const { result } = renderHook(() => useSearchPreferences());
      expect(result.current.radius).toBe(DEFAULT_RADIUS);

      getItemSpy.mockRestore();
    });

    it('7. handles localStorage write failures safely without crashing', () => {
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const { result } = renderHook(() => useSearchPreferences());

      expect(() => {
        act(() => {
          result.current.setRadius(10);
        });
      }).not.toThrow();

      expect(result.current.radius).toBe(10);
      setItemSpy.mockRestore();
    });

    it('8. triggers onRadiusChange callback when radius changes', () => {
      const onRadiusChange = jest.fn();
      const { result } = renderHook(() => useSearchPreferences({ onRadiusChange }));

      act(() => {
        result.current.setRadius(1);
      });

      expect(onRadiusChange).toHaveBeenCalledTimes(1);
      expect(onRadiusChange).toHaveBeenCalledWith(1);
    });

    it('respects explicitly provided valid initialRadius prop without overwriting valid state', () => {
      localStorage.setItem(SEARCH_RADIUS_STORAGE_KEY, '25');

      const { result } = renderHook(() => useSearchPreferences({ initialRadius: 10 }));
      expect(result.current.radius).toBe(10);
    });
  });
});
