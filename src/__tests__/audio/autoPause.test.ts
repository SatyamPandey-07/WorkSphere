import {
  attachWebAudioAutoPause,
  normalizeBatteryThreshold,
  DEFAULT_BATTERY_THRESHOLD,
  type WebAudioAutoPauseController,
} from '@/lib/audio/autoPause';

describe('Web Audio Auto-Pause Utility (autoPause.ts)', () => {
  describe('normalizeBatteryThreshold', () => {
    it('returns default threshold 0.2 for invalid, non-finite, or negative inputs', () => {
      expect(normalizeBatteryThreshold(undefined)).toBe(DEFAULT_BATTERY_THRESHOLD);
      expect(normalizeBatteryThreshold(NaN)).toBe(DEFAULT_BATTERY_THRESHOLD);
      expect(normalizeBatteryThreshold(-0.5)).toBe(DEFAULT_BATTERY_THRESHOLD);
      expect(normalizeBatteryThreshold(Infinity)).toBe(DEFAULT_BATTERY_THRESHOLD);
    });

    it('preserves valid float fractions in [0, 1]', () => {
      expect(normalizeBatteryThreshold(0.15)).toBe(0.15);
      expect(normalizeBatteryThreshold(0)).toBe(0);
      expect(normalizeBatteryThreshold(1)).toBe(1);
    });

    it('converts integer percentages between 1 and 100 to float fractions', () => {
      expect(normalizeBatteryThreshold(20)).toBe(0.2);
      expect(normalizeBatteryThreshold(50)).toBe(0.5);
      expect(normalizeBatteryThreshold(100)).toBe(1.0);
    });

    it('clamps values above 100 to 1.0', () => {
      expect(normalizeBatteryThreshold(150)).toBe(1.0);
    });
  });

  describe('Document visibility detection', () => {
    let mockDoc: {
      hidden: boolean;
      listeners: Record<string, (() => void)[]>;
      addEventListener: jest.Mock;
      removeEventListener: jest.Mock;
      emit: (event: string) => void;
    };
    let onPause: jest.Mock;
    let onResume: jest.Mock;

    beforeEach(() => {
      const listeners: Record<string, (() => void)[]> = {};
      mockDoc = {
        hidden: false,
        listeners,
        addEventListener: jest.fn((event, handler) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        }),
        removeEventListener: jest.fn((event, handler) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter((h) => h !== handler);
          }
        }),
        emit: (event: string) => {
          (listeners[event] || []).forEach((h) => h());
        },
      };

      onPause = jest.fn();
      onResume = jest.fn();
    });

    it('pauses audio when document becomes hidden and resumes when visible', () => {
      const controller = attachWebAudioAutoPause(onPause, onResume, {
        documentTarget: mockDoc,
        getBatteryProvider: () => Promise.reject(),
      });

      expect(controller.isPaused()).toBe(false);

      // Document hidden
      mockDoc.hidden = true;
      mockDoc.emit('visibilitychange');
      expect(controller.isPaused()).toBe(true);
      expect(onPause).toHaveBeenCalledTimes(1);

      // Document visible again
      mockDoc.hidden = false;
      mockDoc.emit('visibilitychange');
      expect(controller.isPaused()).toBe(false);
      expect(onResume).toHaveBeenCalledTimes(1);

      controller.disconnect();
    });

    it('does not trigger redundant onPause or onResume on repeated visibility events', () => {
      const controller = attachWebAudioAutoPause(onPause, onResume, {
        documentTarget: mockDoc,
        getBatteryProvider: () => Promise.reject(),
      });

      mockDoc.hidden = true;
      mockDoc.emit('visibilitychange');
      mockDoc.emit('visibilitychange');
      expect(onPause).toHaveBeenCalledTimes(1);

      mockDoc.hidden = false;
      mockDoc.emit('visibilitychange');
      mockDoc.emit('visibilitychange');
      expect(onResume).toHaveBeenCalledTimes(1);

      controller.disconnect();
    });

    it('safely catches errors thrown inside user callbacks without crashing', () => {
      const throwingPause = jest.fn(() => {
        throw new Error('Callback failure');
      });
      const controller = attachWebAudioAutoPause(throwingPause, onResume, {
        documentTarget: mockDoc,
        getBatteryProvider: () => Promise.reject(),
      });

      mockDoc.hidden = true;
      expect(() => mockDoc.emit('visibilitychange')).not.toThrow();
      expect(controller.isPaused()).toBe(true);

      controller.disconnect();
    });
  });

  describe('Battery saver detection', () => {
    let mockBattery: {
      charging: boolean;
      level: number;
      listeners: Record<string, (() => void)[]>;
      addEventListener: jest.Mock;
      removeEventListener: jest.Mock;
      emit: (event: string) => void;
    };
    let onPause: jest.Mock;
    let onResume: jest.Mock;

    beforeEach(() => {
      const listeners: Record<string, (() => void)[]> = {};
      mockBattery = {
        charging: false,
        level: 0.8,
        listeners,
        addEventListener: jest.fn((event, handler) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        }),
        removeEventListener: jest.fn((event, handler) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter((h) => h !== handler);
          }
        }),
        emit: (event: string) => {
          (listeners[event] || []).forEach((h) => h());
        },
      };

      onPause = jest.fn();
      onResume = jest.fn();
    });

    it('auto-pauses when battery level drops below threshold while discharging', async () => {
      const controller = attachWebAudioAutoPause(onPause, onResume, {
        batteryThreshold: 0.2,
        documentTarget: { hidden: false, addEventListener: jest.fn(), removeEventListener: jest.fn() },
        getBatteryProvider: () => Promise.resolve(mockBattery),
      });

      // Wait for battery manager promise
      await Promise.resolve();

      expect(controller.isPaused()).toBe(false);

      // Battery drops to 15% (discharging)
      mockBattery.level = 0.15;
      mockBattery.emit('levelchange');

      expect(controller.isPaused()).toBe(true);
      expect(onPause).toHaveBeenCalledTimes(1);

      // Device plugged into charger
      mockBattery.charging = true;
      mockBattery.emit('chargingchange');

      expect(controller.isPaused()).toBe(false);
      expect(onResume).toHaveBeenCalledTimes(1);

      controller.disconnect();
    });

    it('correctly parses percentage battery threshold (e.g. 20 -> 0.2)', async () => {
      const controller = attachWebAudioAutoPause(onPause, onResume, {
        batteryThreshold: 20, // 20%
        documentTarget: { hidden: false, addEventListener: jest.fn(), removeEventListener: jest.fn() },
        getBatteryProvider: () => Promise.resolve(mockBattery),
      });

      await Promise.resolve();

      // Battery at 50% should NOT pause
      mockBattery.level = 0.5;
      mockBattery.emit('levelchange');
      expect(controller.isPaused()).toBe(false);

      // Battery at 10% should pause
      mockBattery.level = 0.1;
      mockBattery.emit('levelchange');
      expect(controller.isPaused()).toBe(true);

      controller.disconnect();
    });
  });

  describe('Lifecycle, fast unmount, and post-disconnect cancellation', () => {
    it('cancels pending battery attachment on fast unmount before promise resolves', async () => {
      let resolveBattery: (b: any) => void = () => {};
      const pendingBattery = new Promise((resolve) => {
        resolveBattery = resolve;
      });

      const onPause = jest.fn();
      const mockBattery = {
        charging: false,
        level: 0.05,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      };

      const controller = attachWebAudioAutoPause(onPause, undefined, {
        documentTarget: { hidden: false, addEventListener: jest.fn(), removeEventListener: jest.fn() },
        getBatteryProvider: () => pendingBattery,
      });

      // Quick unmount before promise settles
      controller.disconnect();
      expect(controller.isDisconnected()).toBe(true);

      // Promise resolves after disconnect
      resolveBattery(mockBattery);
      await Promise.resolve();

      // Listeners must NOT be attached to the late battery instance
      expect(mockBattery.addEventListener).not.toHaveBeenCalled();
      expect(onPause).not.toHaveBeenCalled();
    });

    it('ignores subsequent events after disconnect and is safe to call disconnect repeatedly', () => {
      let visibilityHandler: (() => void) | null = null;
      const mockDoc = {
        hidden: false,
        addEventListener: jest.fn((_, h) => {
          visibilityHandler = h;
        }),
        removeEventListener: jest.fn(),
      };

      const onPause = jest.fn();
      const controller = attachWebAudioAutoPause(onPause, undefined, {
        documentTarget: mockDoc,
        getBatteryProvider: () => Promise.reject(),
      });

      controller.disconnect();
      expect(controller.isDisconnected()).toBe(true);

      // Trigger late handler
      mockDoc.hidden = true;
      if (visibilityHandler) {
        (visibilityHandler as () => void)();
      }

      expect(onPause).not.toHaveBeenCalled();

      // Repeated disconnect is safe
      expect(() => controller.disconnect()).not.toThrow();
    });

    it('supports programmatic manual pause() and resume()', () => {
      const onPause = jest.fn();
      const onResume = jest.fn();
      const controller = attachWebAudioAutoPause(onPause, onResume, {
        documentTarget: { hidden: false, addEventListener: jest.fn(), removeEventListener: jest.fn() },
        getBatteryProvider: () => Promise.reject(),
      });

      controller.pause();
      expect(controller.isPaused()).toBe(true);
      expect(onPause).toHaveBeenCalledTimes(1);

      controller.resume();
      expect(controller.isPaused()).toBe(false);
      expect(onResume).toHaveBeenCalledTimes(1);

      controller.disconnect();
    });
  });
});
