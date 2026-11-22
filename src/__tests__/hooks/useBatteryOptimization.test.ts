import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import {
  DEFAULT_CRDT_BATCH_INTERVAL_MS,
  DEFAULT_FFT_SIZE,
  LOW_POWER_CRDT_BATCH_INTERVAL_MS,
  LOW_POWER_FFT_SIZE,
  useBatteryOptimization,
  type BatteryManagerLike,
} from '@/hooks/useBatteryOptimization';
import { useMeshDataChannels } from '@/hooks/useMeshDataChannels';

function createMockBatteryManager(initial: {
  level: number;
  charging: boolean;
}) {
  const listeners: Record<string, Set<EventListenerOrEventListenerObject>> = {
    levelchange: new Set(),
    chargingchange: new Set(),
  };

  const manager = {
    level: initial.level,
    charging: initial.charging,
    addEventListener(
      type: 'levelchange' | 'chargingchange',
      listener: EventListenerOrEventListenerObject | null
    ) {
      if (listener) listeners[type]?.add(listener);
    },
    removeEventListener(
      type: 'levelchange' | 'chargingchange',
      listener: EventListenerOrEventListenerObject | null
    ) {
      if (listener) listeners[type]?.delete(listener);
    },
    dispatchEvent(event: Event): boolean {
      const set = listeners[event.type];
      if (!set) return true;
      for (const fn of Array.from(set)) {
        if (typeof fn === 'function') {
          fn(event);
        } else if (fn && typeof fn.handleEvent === 'function') {
          fn.handleEvent(event);
        }
      }
      return true;
    },
    emit(type: 'levelchange' | 'chargingchange') {
      manager.dispatchEvent(new Event(type));
    },
  } as BatteryManagerLike & { emit: (type: 'levelchange' | 'chargingchange') => void };

  return manager;
}

describe('useBatteryOptimization & useMeshDataChannels power throttling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    const nav = navigator as Navigator & { getBattery?: unknown };
    delete nav.getBattery;
  });

  it('falls back gracefully when navigator.getBattery is unsupported', async () => {
    const { result } = renderHook(() => useBatteryOptimization());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      level: 1,
      charging: true,
      isLowPower: false,
    });
  });

  it('activates low-power mode when battery drops below 20% while discharging and disables on charging', async () => {
    const mockBM = createMockBatteryManager({ level: 0.45, charging: false });
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    nav.getBattery = jest.fn().mockResolvedValue(mockBM);

    const { result } = renderHook(() => useBatteryOptimization());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isLowPower).toBe(false);

    act(() => {
      mockBM.level = 0.15;
      mockBM.emit('levelchange');
    });

    expect(result.current).toEqual({
      level: 0.15,
      charging: false,
      isLowPower: true,
    });

    act(() => {
      mockBM.charging = true;
      mockBM.emit('chargingchange');
    });

    expect(result.current).toEqual({
      level: 0.15,
      charging: true,
      isLowPower: false,
    });
  });

  it('updates CRDT batch interval from 50ms to 500ms, pauses animations, and lowers FFT from 2048 to 256 on low power', () => {
    const sentMessages: string[] = [];
    const mockChannel = {
      readyState: 'open',
      send: (data: string) => sentMessages.push(data),
    };

    let latestProfile: ReturnType<typeof useMeshDataChannels> | null = null;

    function Probe({ lowPower }: { lowPower: boolean }) {
      const hook = useMeshDataChannels({
        channels: { crdt: mockChannel },
        batteryOverride: lowPower
          ? { level: 0.12, charging: false, isLowPower: true }
          : { level: 0.8, charging: false, isLowPower: false },
      });
      latestProfile = hook;
      return null;
    }

    const { rerender } = render(<Probe lowPower={false} />);
    expect(latestProfile?.crdtBatchIntervalMs).toBe(DEFAULT_CRDT_BATCH_INTERVAL_MS);
    expect(latestProfile?.fftSize).toBe(DEFAULT_FFT_SIZE);
    expect(latestProfile?.pauseDecorativeAnimations).toBe(false);

    rerender(<Probe lowPower={true} />);
    expect(latestProfile?.crdtBatchIntervalMs).toBe(LOW_POWER_CRDT_BATCH_INTERVAL_MS);
    expect(latestProfile?.fftSize).toBe(LOW_POWER_FFT_SIZE);
    expect(latestProfile?.pauseDecorativeAnimations).toBe(true);

    act(() => {
      latestProfile?.queueCrdtUpdate({ doc: 'notes', op: 'insert' });
      latestProfile?.flushNow();
    });

    expect(sentMessages).toHaveLength(1);
    expect(JSON.parse(sentMessages[0])).toMatchObject({
      type: 'crdt_batch',
      batchIntervalMs: 500,
    });
  });
});