import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  CarbonFootprintTracker,
  computeCarbonSavingsForRange,
  validateCustomDateRange,
} from '@/components/analytics/CarbonFootprintTracker';

describe('CarbonFootprintTracker custom date range & emissions', () => {
  const today = '2026-11-22';

  it('validates boundary dates, inverted ranges, and future dates cleanly', () => {
    expect(validateCustomDateRange('2026-11-22', '2026-11-22', today)).toBeNull();
    expect(validateCustomDateRange('2026-11-10', '2026-11-15', today)).toBeNull();
    expect(validateCustomDateRange('2026-11-18', '2026-11-12', today)).toBe(
      'Start date must be on or before the end date.'
    );
    expect(validateCustomDateRange('2026-11-20', '2026-11-25', today)).toBe(
      'Dates cannot be in the future.'
    );
  });

  it('reveals custom inputs, deselects presets, and recomputes baseline vs actual savings', () => {
    render(
      <CarbonFootprintTracker
        todayIso={today}
        dailyBaselineKgCo2={10}
        dailyActualKgCo2={4}
      />
    );

    const preset30d = screen.getByTestId('preset-30d');
    expect(preset30d).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('custom-range-toggle'));
    expect(screen.getByTestId('custom-date-controls')).toBeInTheDocument();
    expect(preset30d).toHaveAttribute('aria-pressed', 'false');

    const startInput = screen.getByTestId('custom-start-date');
    const endInput = screen.getByTestId('custom-end-date');

    fireEvent.change(startInput, { target: { value: '2026-11-10' } });
    fireEvent.change(endInput, { target: { value: '2026-11-14' } });

    expect(screen.queryByTestId('custom-date-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('baseline-emissions')).toHaveTextContent('50.00 kg CO₂');
    expect(screen.getByTestId('actual-emissions')).toHaveTextContent('20.00 kg CO₂');
    expect(screen.getByTestId('saved-emissions')).toHaveTextContent('30.00 kg CO₂ (60%)');

    const direct = computeCarbonSavingsForRange('2026-11-12', '2026-11-12', {
      dailyBaselineKgCo2: 10,
      dailyActualKgCo2: 4,
    });
    expect(direct.daysCount).toBe(1);
    expect(direct.savedKgCo2).toBe(6);
  });

  it('displays an inline warning without crashing when startDate > endDate or future date is entered', () => {
    render(<CarbonFootprintTracker todayIso={today} />);
    fireEvent.click(screen.getByTestId('custom-range-toggle'));

    fireEvent.change(screen.getByTestId('custom-start-date'), {
      target: { value: '2026-11-20' },
    });
    fireEvent.change(screen.getByTestId('custom-end-date'), {
      target: { value: '2026-11-15' },
    });

    expect(screen.getByTestId('custom-date-error')).toHaveTextContent(
      'Start date must be on or before the end date.'
    );
    expect(screen.getByTestId('carbon-footprint-tracker')).toBeInTheDocument();
  });
});