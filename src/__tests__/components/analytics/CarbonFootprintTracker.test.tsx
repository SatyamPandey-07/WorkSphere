import React from 'react';
import { render, screen } from '@testing-library/react';
import { CarbonFootprintTracker } from '@/components/analytics/CarbonFootprintTracker';

describe('CarbonFootprintTracker', () => {
  it('clamps progress bar fill to 100% and displays an above-baseline badge at 135%', () => {
    render(
      <CarbonFootprintTracker
        venueName="Bandra Cowork Hub"
        actualKwh={1350}
        baselineKwh={1000}
      />
    );

    const fill = screen.getByTestId('energy-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(screen.getByTestId('above-baseline-badge').textContent).toBe(
      '+35% above baseline'
    );
  });

  it('clamps negative values to 0% and hides the over-baseline badge when within baseline', () => {
    render(
      <CarbonFootprintTracker
        venueName="Lower Parel Space"
        actualKwh={-50}
        baselineKwh={500}
      />
    );

    const fill = screen.getByTestId('energy-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
    expect(screen.queryByTestId('above-baseline-badge')).toBeNull();
  });
});
