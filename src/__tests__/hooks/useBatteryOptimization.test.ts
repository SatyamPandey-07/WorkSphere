import { computeBatteryOptimizationState } from '@/hooks/useBatteryOptimization';

describe('computeBatteryOptimizationState', () => {
  it('activates low-power mode when discharging below 20% charge', () => {
    const low = computeBatteryOptimizationState(0.15, false);
    expect(low.isLowPowerMode).toBe(true);
    expect(low.crdtBatchIntervalMs).toBe(500);
    expect(low.pauseDecorativeAnimations).toBe(true);
    expect(low.fftSize).toBe(256);
  });

  it('keeps normal performance settings when charging or above 20% or unavailable', () => {
    expect(computeBatteryOptimizationState(0.15, true).isLowPowerMode).toBe(false);
    expect(computeBatteryOptimizationState(0.5, false).crdtBatchIntervalMs).toBe(50);
    expect(computeBatteryOptimizationState(0.5, false).fftSize).toBe(2048);
    expect(computeBatteryOptimizationState(null, null).isLowPowerMode).toBe(false);
  });
});