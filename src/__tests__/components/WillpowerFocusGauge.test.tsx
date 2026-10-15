// @ts-nocheck
import React from 'react';
import { render, screen } from '@testing-library/react';
import { WillpowerFocusGauge } from '@/components/wellness/WillpowerFocusGauge';

describe('WillpowerFocusGauge Component', () => {
  it('renders initial formatted time and progress percentage correctly', () => {
    render(<WillpowerFocusGauge initialMinutes={25} />);

    const timer = screen.getByTestId('timer-display');
    const progress = screen.getByTestId('progress-display');

    expect(timer.textContent).toBe('25:00');
    expect(progress.textContent).toContain('0% CHARGED');
  });

  it('renders tactile play and reset controls', () => {
    render(<WillpowerFocusGauge />);

    expect(screen.getByRole('button', { name: /Start Focus/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset/i })).toBeInTheDocument();
  });
});