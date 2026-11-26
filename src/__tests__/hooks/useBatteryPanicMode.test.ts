import { renderHook, act, waitFor } from '@testing-library/react';
import {
    useBatteryPanicMode,
    BatteryManagerLike,
} from '@/hooks/useBatteryPanicMode';

class MockBatteryManager extends EventTarget implements BatteryManagerLike {
    public charging: boolean;
    public chargingTime = Infinity;
    public dischargingTime = 3600;
    public level: number;

    constructor(level = 0.85, charging = false) {
        super();
        this.level = level;
        this.charging = charging;
    }
}

describe('useBatteryPanicMode', () => {
    const originalGetBattery = (navigator as Navigator & { getBattery?: unknown }).getBattery;

    afterEach(() => {
        if (originalGetBattery === undefined) {
            delete (navigator as Navigator & { getBattery?: unknown }).getBattery;
        } else {
            Object.defineProperty(navigator, 'getBattery', {
                configurable: true,
                value: originalGetBattery,
            });
        }
        jest.restoreAllMocks();
    });

    test('degrades gracefully without throwing when navigator.getBattery is unsupported (Safari/Firefox)', () => {
        delete (navigator as Navigator & { getBattery?: unknown }).getBattery;

        const { result } = renderHook(() => useBatteryPanicMode());

        expect(result.current.isSupported).toBe(false);
        expect(result.current.batteryLevelPercent).toBeNull();
        expect(result.current.isCharging).toBeNull();
        expect(result.current.isPanicModeActive).toBe(false);
    });

    test('activates panic mode when unplugged battery drops <= 20% and cleans up listeners on unmount', async () => {
        const mockBattery = new MockBatteryManager(0.5, false);
        const addListenerSpy = jest.spyOn(mockBattery, 'addEventListener');
        const removeListenerSpy = jest.spyOn(mockBattery, 'removeEventListener');

        Object.defineProperty(navigator, 'getBattery', {
            configurable: true,
            value: jest.fn().mockResolvedValue(mockBattery),
        });

        const { result, unmount } = renderHook(() =>
            useBatteryPanicMode({ thresholdPercent: 20 })
        );

        await waitFor(() => {
            expect(result.current.isSupported).toBe(true);
        });

        expect(result.current.batteryLevelPercent).toBe(50);
        expect(result.current.isPanicModeActive).toBe(false);
        expect(addListenerSpy).toHaveBeenCalledWith('levelchange', expect.any(Function));
        expect(addListenerSpy).toHaveBeenCalledWith('chargingchange', expect.any(Function));

        // Drop battery to 18% while unplugged -> activates panic mode
        act(() => {
            mockBattery.level = 0.18;
            mockBattery.dispatchEvent(new Event('levelchange'));
        });

        expect(result.current.batteryLevelPercent).toBe(18);
        expect(result.current.isPanicModeActive).toBe(true);

        // Plug charger in -> deactivates panic mode immediately
        act(() => {
            mockBattery.charging = true;
            mockBattery.dispatchEvent(new Event('chargingchange'));
        });

        expect(result.current.isCharging).toBe(true);
        expect(result.current.isPanicModeActive).toBe(false);

        // Unmount hook -> both listeners must be removed from BatteryManager
        unmount();

        expect(removeListenerSpy).toHaveBeenCalledWith('levelchange', expect.any(Function));
        expect(removeListenerSpy).toHaveBeenCalledWith('chargingchange', expect.any(Function));
    });
});