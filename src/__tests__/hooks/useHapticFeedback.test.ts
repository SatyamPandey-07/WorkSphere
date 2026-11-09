import { renderHook, act } from "@testing-library/react";
import {
  useHapticFeedback,
  triggerHapticFeedback,
  HAPTIC_PATTERNS,
  isHapticSupported,
} from "@/hooks/useHapticFeedback";

describe("useHapticFeedback hook & standalone trigger", () => {
  let mockVibrate: jest.Mock;

  beforeEach(() => {
    mockVibrate = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      value: mockVibrate,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports isSupported as true when navigator.vibrate is defined", () => {
    const { result } = renderHook(() => useHapticFeedback());
    expect(result.current.isSupported).toBe(true);
    expect(isHapticSupported()).toBe(true);
  });

  it("reports isSupported as false when navigator.vibrate is undefined", () => {
    Object.defineProperty(navigator, "vibrate", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useHapticFeedback());
    expect(result.current.isSupported).toBe(false);
    expect(isHapticSupported()).toBe(false);
  });

  it("triggers light tap pattern [10] by default", () => {
    const { result } = renderHook(() => useHapticFeedback());

    act(() => {
      const ok = result.current.trigger();
      expect(ok).toBe(true);
    });

    expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.light);
    expect(mockVibrate).toHaveBeenCalledWith([10]);
  });

  it("triggers light tap pattern using triggerLight shortcut", () => {
    const { result } = renderHook(() => useHapticFeedback());

    act(() => {
      result.current.triggerLight();
    });

    expect(mockVibrate).toHaveBeenCalledWith([10]);
  });

  it("triggers success confirmation pattern [15, 50, 20] using triggerSuccess", () => {
    const { result } = renderHook(() => useHapticFeedback());

    act(() => {
      const ok = result.current.triggerSuccess();
      expect(ok).toBe(true);
    });

    expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.success);
    expect(mockVibrate).toHaveBeenCalledWith([15, 50, 20]);
  });

  it("triggers error alert pattern [50, 100, 50] using triggerError", () => {
    const { result } = renderHook(() => useHapticFeedback());

    act(() => {
      const ok = result.current.triggerError();
      expect(ok).toBe(true);
    });

    expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.error);
    expect(mockVibrate).toHaveBeenCalledWith([50, 100, 50]);
  });

  it("supports passing custom number or array pattern", () => {
    const { result } = renderHook(() => useHapticFeedback());

    act(() => {
      result.current.trigger([100, 50, 100]);
    });

    expect(mockVibrate).toHaveBeenCalledWith([100, 50, 100]);
  });

  it("does not call navigator.vibrate when enabled option is false", () => {
    const { result } = renderHook(() => useHapticFeedback({ enabled: false }));

    act(() => {
      const ok = result.current.triggerSuccess();
      expect(ok).toBe(false);
    });

    expect(mockVibrate).not.toHaveBeenCalled();
  });

  it("handles navigator.vibrate throwing an exception gracefully without uncaught error", () => {
    mockVibrate.mockImplementation(() => {
      throw new Error("SecurityError: vibrate call denied");
    });

    const { result } = renderHook(() => useHapticFeedback());

    let ok: boolean | undefined;
    expect(() => {
      act(() => {
        ok = result.current.triggerSuccess();
      });
    }).not.toThrow();

    expect(ok).toBe(false);
  });

  it("allows calling standalone triggerHapticFeedback helper directly", () => {
    const ok = triggerHapticFeedback("success");
    expect(ok).toBe(true);
    expect(mockVibrate).toHaveBeenCalledWith([15, 50, 20]);
  });
});
