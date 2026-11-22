import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  getRemainingMs,
  ReservationTimerBadge,
} from '@/components/reservations/ReservationTimerBadge';

describe('ReservationTimerBadge wall-clock countdown accuracy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives remaining time from Math.max(0, expiresAt - Date.now()) after background tab jump', () => {
    let now = 1_700_000_000_000;
    const fiveMinutesMs = 5 * 60 * 1000;
    const expiresAt = now + fiveMinutesMs;

    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const onExpire = jest.fn();

    render(<ReservationTimerBadge expiresAt={expiresAt} onExpire={onExpire} />);
    expect(screen.getByTestId('reservation-timer-value')).toHaveTextContent('05:00');

    now += 2 * 60 * 1000;
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      fireEvent.focus(window);
    });

    expect(screen.getByTestId('reservation-timer-value')).toHaveTextContent('03:00');
    expect(getRemainingMs(expiresAt, now)).toBe(3 * 60 * 1000);

    now = expiresAt + 1_000;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByTestId('reservation-timer-value')).toHaveTextContent('00:00');
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});