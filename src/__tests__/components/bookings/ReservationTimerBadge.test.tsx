import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  ReservationTimerBadge,
  HOLD_DURATION_SECONDS,
  DEFAULT_RING_RADIUS,
  calculateProgress,
  calculateCircumference,
  calculateStrokeDashoffset,
  getTimerRingColor,
  formatRemainingTime,
  TIMER_COLOR_CONFIG,
} from '@/components/bookings/ReservationTimerBadge';

describe('ReservationTimerBadge Component (#7756)', () => {
  const defaultCircumference = 2 * Math.PI * DEFAULT_RING_RADIUS;

  describe('Progress calculations', () => {
    it('1. 600 seconds → full ring (progress 1.0, strokeDashoffset 0)', () => {
      const progress = calculateProgress(600, HOLD_DURATION_SECONDS);
      expect(progress).toBe(1.0);

      const offset = calculateStrokeDashoffset(progress, defaultCircumference);
      expect(offset).toBe(0);

      render(<ReservationTimerBadge remainingSeconds={600} />);
      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(Number(progressCircle.getAttribute('stroke-dashoffset'))).toBe(0);
    });

    it('2. 300 seconds → approximately 50% progress', () => {
      const progress = calculateProgress(300, HOLD_DURATION_SECONDS);
      expect(progress).toBe(0.5);

      const offset = calculateStrokeDashoffset(progress, defaultCircumference);
      expect(offset).toBeCloseTo(defaultCircumference * 0.5, 3);

      render(<ReservationTimerBadge remainingSeconds={300} />);
      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(
        Number(progressCircle.getAttribute('stroke-dashoffset')),
      ).toBeCloseTo(defaultCircumference * 0.5, 3);
    });

    it('3. 0 seconds → empty ring (progress 0.0, strokeDashoffset = circumference)', () => {
      const progress = calculateProgress(0, HOLD_DURATION_SECONDS);
      expect(progress).toBe(0);

      const offset = calculateStrokeDashoffset(progress, defaultCircumference);
      expect(offset).toBeCloseTo(defaultCircumference, 3);

      render(<ReservationTimerBadge remainingSeconds={0} />);
      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(
        Number(progressCircle.getAttribute('stroke-dashoffset')),
      ).toBeCloseTo(defaultCircumference, 3);
    });

    it('4. Negative seconds → clamped to zero (empty ring)', () => {
      const progress = calculateProgress(-45, HOLD_DURATION_SECONDS);
      expect(progress).toBe(0);

      const offset = calculateStrokeDashoffset(progress, defaultCircumference);
      expect(offset).toBeCloseTo(defaultCircumference, 3);

      render(<ReservationTimerBadge remainingSeconds={-45} />);
      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(
        Number(progressCircle.getAttribute('stroke-dashoffset')),
      ).toBeCloseTo(defaultCircumference, 3);
    });

    it('5. Values above 600 seconds → clamped to full progress (strokeDashoffset 0)', () => {
      const progress = calculateProgress(750, HOLD_DURATION_SECONDS);
      expect(progress).toBe(1.0);

      const offset = calculateStrokeDashoffset(progress, defaultCircumference);
      expect(offset).toBe(0);

      render(<ReservationTimerBadge remainingSeconds={750} />);
      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(Number(progressCircle.getAttribute('stroke-dashoffset'))).toBe(0);
    });
  });

  describe('Color transitions', () => {
    it('1. More than 300 seconds → green', () => {
      expect(getTimerRingColor(301)).toBe('green');
      expect(getTimerRingColor(600)).toBe('green');

      render(<ReservationTimerBadge remainingSeconds={450} />);
      const badge = screen.getByTestId('reservation-timer-badge');
      expect(badge).toHaveAttribute('data-color', 'green');
      expect(badge).toHaveClass('text-emerald-400');

      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(progressCircle).toHaveAttribute(
        'stroke',
        TIMER_COLOR_CONFIG.green.ringColor,
      );
    });

    it('2. Exactly 300 seconds → yellow', () => {
      expect(getTimerRingColor(300)).toBe('yellow');

      render(<ReservationTimerBadge remainingSeconds={300} />);
      const badge = screen.getByTestId('reservation-timer-badge');
      expect(badge).toHaveAttribute('data-color', 'yellow');
      expect(badge).toHaveClass('text-amber-400');

      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(progressCircle).toHaveAttribute(
        'stroke',
        TIMER_COLOR_CONFIG.yellow.ringColor,
      );
    });

    it('3. Between 120 and 300 seconds → yellow', () => {
      expect(getTimerRingColor(200)).toBe('yellow');
      expect(getTimerRingColor(121)).toBe('yellow');

      render(<ReservationTimerBadge remainingSeconds={200} />);
      const badge = screen.getByTestId('reservation-timer-badge');
      expect(badge).toHaveAttribute('data-color', 'yellow');
      expect(badge).toHaveClass('text-amber-400');
    });

    it('4. Exactly 120 seconds → yellow', () => {
      expect(getTimerRingColor(120)).toBe('yellow');

      render(<ReservationTimerBadge remainingSeconds={120} />);
      const badge = screen.getByTestId('reservation-timer-badge');
      expect(badge).toHaveAttribute('data-color', 'yellow');
      expect(badge).toHaveClass('text-amber-400');
      expect(badge).not.toHaveClass('animate-pulse');
    });

    it('5. Less than 120 seconds → red with pulsing state', () => {
      expect(getTimerRingColor(119)).toBe('red');
      expect(getTimerRingColor(60)).toBe('red');

      render(<ReservationTimerBadge remainingSeconds={119} />);
      const badge = screen.getByTestId('reservation-timer-badge');
      expect(badge).toHaveAttribute('data-color', 'red');
      expect(badge).toHaveClass('text-red-400');
      expect(badge).toHaveClass('animate-pulse');

      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(progressCircle).toHaveAttribute(
        'stroke',
        TIMER_COLOR_CONFIG.red.ringColor,
      );
    });

    it('6. Expired timer → red/empty state, consistent with expiry behavior', () => {
      expect(getTimerRingColor(0)).toBe('red');
      expect(getTimerRingColor(-10)).toBe('red');

      render(<ReservationTimerBadge remainingSeconds={0} />);
      const badge = screen.getByTestId('reservation-timer-badge');
      expect(badge).toHaveAttribute('data-color', 'red');

      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(
        Number(progressCircle.getAttribute('stroke-dashoffset')),
      ).toBeCloseTo(defaultCircumference, 3);

      const text = screen.getByTestId('reservation-timer-text');
      expect(text).toHaveTextContent('00:00');
    });
  });

  describe('UI behavior and Accessibility', () => {
    it('1. SVG ring renders correctly with track and progress circles', () => {
      render(<ReservationTimerBadge remainingSeconds={500} />);

      const svg = screen.getByTestId('reservation-timer-ring');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('role', 'presentation');

      const track = screen.getByTestId('timer-ring-track');
      expect(track).toBeInTheDocument();
      expect(track).toHaveAttribute('r', String(DEFAULT_RING_RADIUS));

      const progress = screen.getByTestId('timer-ring-progress');
      expect(progress).toBeInTheDocument();
      expect(progress).toHaveAttribute('stroke-linecap', 'round');
      expect(progress.getAttribute('transform')).toContain('rotate(-90');
    });

    it('2. Numeric countdown remains visible and formatted accurately', () => {
      const { rerender } = render(
        <ReservationTimerBadge remainingSeconds={600} />,
      );
      expect(screen.getByTestId('reservation-timer-text')).toHaveTextContent(
        'Hold: 10:00',
      );

      rerender(<ReservationTimerBadge remainingSeconds={305} />);
      expect(screen.getByTestId('reservation-timer-text')).toHaveTextContent(
        'Hold: 05:05',
      );

      rerender(<ReservationTimerBadge remainingSeconds={65} />);
      expect(screen.getByTestId('reservation-timer-text')).toHaveTextContent(
        'Hold: 01:05',
      );

      rerender(<ReservationTimerBadge remainingSeconds={0} />);
      expect(screen.getByTestId('reservation-timer-text')).toHaveTextContent(
        'Hold: 00:00',
      );
    });

    it('3. strokeDasharray is calculated correctly based on circumference', () => {
      const radius = 12;
      const expectedCircumference = 2 * Math.PI * radius;

      render(
        <ReservationTimerBadge remainingSeconds={300} radius={radius} />,
      );
      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(
        Number(progressCircle.getAttribute('stroke-dasharray')),
      ).toBeCloseTo(expectedCircumference, 4);
    });

    it('4. strokeDashoffset updates dynamically when remaining seconds change', () => {
      const { rerender } = render(
        <ReservationTimerBadge remainingSeconds={600} />,
      );
      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(Number(progressCircle.getAttribute('stroke-dashoffset'))).toBe(0);

      rerender(<ReservationTimerBadge remainingSeconds={300} />);
      expect(
        Number(progressCircle.getAttribute('stroke-dashoffset')),
      ).toBeCloseTo(defaultCircumference * 0.5, 3);

      rerender(<ReservationTimerBadge remainingSeconds={0} />);
      expect(
        Number(progressCircle.getAttribute('stroke-dashoffset')),
      ).toBeCloseTo(defaultCircumference, 3);
    });

    it('5. Red pulsing class is applied below 120 seconds and omitted at or above 120 seconds', () => {
      const { rerender } = render(
        <ReservationTimerBadge remainingSeconds={120} />,
      );
      const badge = screen.getByTestId('reservation-timer-badge');
      expect(badge).not.toHaveClass('animate-pulse');
      expect(badge).toHaveAttribute('data-pulsing', 'false');

      rerender(<ReservationTimerBadge remainingSeconds={119} />);
      expect(badge).toHaveClass('animate-pulse');
      expect(badge).toHaveAttribute('data-pulsing', 'true');
    });

    it('6. Reduced-motion styling is respected with motion-reduce classes', () => {
      render(<ReservationTimerBadge remainingSeconds={60} />);

      const badge = screen.getByTestId('reservation-timer-badge');
      expect(badge).toHaveClass('motion-reduce:animate-none');

      const progressCircle = screen.getByTestId('timer-ring-progress');
      expect(progressCircle).toHaveClass('motion-reduce:transition-none');
    });

    it('7. No duplicate timer or interval is introduced when controlled remainingSeconds is provided', () => {
      const setIntervalSpy = jest.spyOn(window, 'setInterval');

      render(<ReservationTimerBadge remainingSeconds={300} />);
      expect(setIntervalSpy).not.toHaveBeenCalled();

      setIntervalSpy.mockRestore();
    });

    it('handles autonomous countdown and unmount cleanup when uncontrolled', () => {
      jest.useFakeTimers();
      const onExpire = jest.fn();

      const { unmount } = render(
        <ReservationTimerBadge
          totalDurationSeconds={10}
          onExpire={onExpire}
        />,
      );

      expect(screen.getByTestId('reservation-timer-text')).toHaveTextContent(
        'Hold: 00:10',
      );

      // Advance by 3 seconds
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(screen.getByTestId('reservation-timer-text')).toHaveTextContent(
        'Hold: 00:07',
      );

      // Advance to expiration
      act(() => {
        jest.advanceTimersByTime(7000);
      });
      expect(onExpire).toHaveBeenCalledTimes(1);

      // Clean up on unmount
      unmount();
      jest.useRealTimers();
    });

    it('provides accessible role="timer" and screen reader labels without duplicate announcement', () => {
      render(<ReservationTimerBadge remainingSeconds={100} />);
      const timer = screen.getByRole('timer');
      expect(timer).toHaveAttribute('aria-live', 'polite');
      expect(timer).toHaveAttribute('aria-atomic', 'true');
      expect(timer).toHaveAttribute(
        'aria-label',
        'Seat reservation hold expires soon: 01:40 remaining',
      );
    });
  });

  describe('Utility functions', () => {
    it('formatRemainingTime clamps negative values to 00:00', () => {
      expect(formatRemainingTime(-10)).toBe('00:00');
      expect(formatRemainingTime(0)).toBe('00:00');
      expect(formatRemainingTime(59)).toBe('00:59');
      expect(formatRemainingTime(600)).toBe('10:00');
    });

    it('calculateCircumference computes exact 2 * PI * r', () => {
      expect(calculateCircumference(10)).toBe(2 * Math.PI * 10);
      expect(calculateCircumference(14)).toBe(2 * Math.PI * 14);
    });
  });
});
