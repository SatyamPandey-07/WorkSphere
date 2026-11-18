import { renderHook, act, cleanup } from "@testing-library/react";
import { useSmoothAudioParam } from "@/hooks/useSmoothAudioParam";

describe("useSmoothAudioParam Hook", () => {
  let mockParam: jest.Mocked<AudioParam>;
  let mockContext: jest.Mocked<AudioContext>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockContext = {
      currentTime: 1.5,
      state: "running",
    } as unknown as jest.Mocked<AudioContext>;

    mockParam = {
      context: mockContext,
      value: 0,
      setValueAtTime: jest.fn(),
      setTargetAtTime: jest.fn(),
      cancelScheduledValues: jest.fn(),
    } as unknown as jest.Mocked<AudioParam>;
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("returns null when param is null", () => {
    const { result, unmount } = renderHook(() => useSmoothAudioParam(null));
    expect(result.current).toBeNull();
    unmount();
  });

  it("returns a stable setter function when param is provided", () => {
    const { result, rerender, unmount } = renderHook(
      ({ param }) => useSmoothAudioParam(param, { minGain: -30, maxGain: 6 }),
      { initialProps: { param: mockParam } }
    );

    expect(typeof result.current).toBe("function");
    const firstSetter = result.current;

    rerender({ param: mockParam });
    expect(result.current).toBe(firstSetter);
    unmount();
  });

  it("applies gain via setter function", () => {
    const { result, unmount } = renderHook(() =>
      useSmoothAudioParam(mockParam, { minGain: -40, maxGain: 10, timeConstant: 0.05 })
    );

    act(() => {
      result.current?.(5);
    });

    expect(mockParam.cancelScheduledValues).toHaveBeenCalledWith(1.5);
    expect(mockParam.setValueAtTime).toHaveBeenCalledWith(0, 1.5);
    expect(mockParam.setTargetAtTime).toHaveBeenCalledWith(5, 1.5, 0.05);

    act(() => {
      jest.advanceTimersByTime(200);
    });

    unmount();
  });

  it("cancels scheduled values and disposes controller on unmount", () => {
    const { unmount } = renderHook(() => useSmoothAudioParam(mockParam));

    unmount();

    expect(mockParam.cancelScheduledValues).toHaveBeenCalledWith(1.5);
  });
});
