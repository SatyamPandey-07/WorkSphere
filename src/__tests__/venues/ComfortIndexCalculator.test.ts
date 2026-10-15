import { calculateComfortIndex } from '@/lib/venues/ComfortIndexCalculator';

describe('ComfortIndexCalculator (ASHRAE Standard 55)', () => {
  it('should return a high score and ideal category for optimal indoor conditions', () => {
    const result = calculateComfortIndex(22, 45);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.category).toBe('ideal');
    expect(result.badgeText).toContain('22°C, 45% Humidity');
  });

  it('should categorize environments as too_cold when temperature is low', () => {
    const result = calculateComfortIndex(16, 40);
    expect(result.category).toBe('too_cold');
    expect(result.score).toBeLessThan(70);
  });

  it('should categorize environments as too_warm when temperature is high', () => {
    const result = calculateComfortIndex(29, 50);
    expect(result.category).toBe('too_warm');
    expect(result.score).toBeLessThan(70);
  });

  it('should categorize environments as humid when relative humidity is excessively high', () => {
    const result = calculateComfortIndex(23, 80);
    expect(result.category).toBe('humid');
  });

  it('should clamp scores between 0 and 100', () => {
    const extremeCold = calculateComfortIndex(5, 10);
    const extremeHot = calculateComfortIndex(45, 95);

    expect(extremeCold.score).toBe(0);
    expect(extremeHot.score).toBe(0);
  });
});