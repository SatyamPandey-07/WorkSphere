import React from 'react';
import { render, screen } from '@testing-library/react';
import { CarbonFootprintTracker } from '@/components/analytics/CarbonFootprintTracker';
import { calculateCarbonSavingsPercent } from '@/lib/analytics';

describe('CarbonFootprintTracker & calculateCarbonSavingsPercent', () => {
  it('defaults to 0% when baseline is zero or non-finite without NaN or Infinity', () => {
    expect(calculateCarbonSavingsPercent(0, 0)).toBe(0);
    expect(calculateCarbonSavingsPercent(0, 12.5)).toBe(0);
    expect(calculateCarbonSavingsPercent(-5, 3)).toBe(0);
    expect(calculateCarbonSavingsPercent(Number.NaN, 10)).toBe(0);
    expect(calculateCarbonSavingsPercent(Number.POSITIVE_INFINITY, 10)).toBe(0);

    render(<CarbonFootprintTracker baselineKg={0} actualKg={0} tripCount={0} />);
    const valueEl = screen.getByTestId('carbon-savings-value');
    expect(valueEl).toHaveTextContent('0%');
    expect(valueEl.textContent).not.toContain('NaN');
    expect(valueEl.textContent).not.toContain('Infinity');
  });

  it('computes positive carbon reduction percentage and clamps negative savings to 0%', () => {
    expect(calculateCarbonSavingsPercent(100, 75)).toBe(25);
    expect(calculateCarbonSavingsPercent(80, 100)).toBe(0);

    render(<CarbonFootprintTracker baselineKg={100} actualKg={60} tripCount={4} />);
    expect(screen.getByTestId('carbon-savings-value')).toHaveTextContent('40%');
  });
});