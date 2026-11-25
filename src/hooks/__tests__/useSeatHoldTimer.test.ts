import { act, renderHook } from '@testing-library/react';
import { useSeatHoldTimer } from '../useSeatHoldTimer';

describe('useSeatHoldTimer (#9164)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('clears interval and timeout on unmount without triggering post-unmount updates', () => {
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
    const onExpire = jest.fn();

    const { result, unmount } = renderHook(() =>
      useSeatHoldTimer('desk-101', { durationSeconds: 600, onExpire })
    );

    expect(result.current.remainingSeconds).toBe(600);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current.remainingSeconds).toBe(597);

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(600_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('marks hold expired and fires onExpire after full duration', () => {
    const onExpire = jest.fn();

    const { result, unmount } = renderHook(() =>
      useSeatHoldTimer('desk-202', { durationSeconds: 5, onExpire })
    );

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.remainingSeconds).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);

    unmount();
  });
});