import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  DEFAULT_SEAT_HOLD_DURATION_MS,
  ReservationTimerBadge,
} from '@/components/reservations/ReservationTimerBadge';

describe('ReservationTimerBadge drift-free countdown & tab resync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-22T14:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('computes remaining time directly from expiresAt and resyncs immediately on visibilitychange and focus', () => {
    const expiresAt = Date.now() + DEFAULT_SEAT_HOLD_DURATION_MS;
    const onExpire = jest.fn();

    render(<ReservationTimerBadge expiresAt={expiresAt} onExpire={onExpire} />);
    expect(screen.getByTestId('reservation-timer-value')).toHaveTextContent('05:00 hold');

    act(() => {
      jest.setSystemTime(new Date(expiresAt - 110_000));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByTestId('reservation-timer-value')).toHaveTextContent('01:50 hold');

    act(() => {
      jest.setSystemTime(new Date(expiresAt + 2_000));
      fireEvent(window, new Event('focus'));
    });

    expect(screen.getByTestId('reservation-timer-value')).toHaveTextContent('00:00 · Expired');
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});