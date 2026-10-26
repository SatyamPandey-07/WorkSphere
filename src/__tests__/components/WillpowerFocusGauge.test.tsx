import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WillpowerFocusGauge } from '@/components/wellness/WillpowerFocusGauge';

describe('WillpowerFocusGauge Component', () => {
  const mockClose = jest.fn();
  const mockSetValueAtTime = jest.fn();
  const mockExponentialRampToValueAtTime = jest.fn();
  const mockConnect = jest.fn();
  const mockStart = jest.fn();
  const mockStop = jest.fn();

  class MockAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    createOscillator() {
      return {
        type: 'sine',
        frequency: { setValueAtTime: mockSetValueAtTime },
        connect: mockConnect,
        start: mockStart,
        stop: mockStop,
        onended: null as (() => void) | null,
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: mockSetValueAtTime,
          exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
        },
        connect: mockConnect,
      };
    }
    close() {
      this.state = 'closed';
      mockClose();
      return Promise.resolve();
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (window as unknown as { AudioContext: typeof MockAudioContext }).AudioContext = MockAudioContext;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('renders initial formatted time and progress percentage correctly', () => {
    render(<WillpowerFocusGauge initialMinutes={25} />);

    const timer = screen.getByTestId('timer-display');
    const progress = screen.getByTestId('progress-display');

    expect(timer.textContent).toBe('25:00');
    expect(progress.textContent).toContain('0% CHARGED');
  });

  it('handles invalid or non-positive initialMinutes gracefully without NaN display', () => {
    render(<WillpowerFocusGauge initialMinutes={NaN as unknown as number} />);

    const timer = screen.getByTestId('timer-display');
    const progress = screen.getByTestId('progress-display');

    expect(timer.textContent).toBe('25:00');
    expect(progress.textContent).toBe('0% CHARGED');
  });

  it('handles negative initialMinutes by falling back to default', () => {
    render(<WillpowerFocusGauge initialMinutes={-10} />);

    const timer = screen.getByTestId('timer-display');
    expect(timer.textContent).toBe('25:00');
  });

  it('renders tactile play and reset controls', () => {
    render(<WillpowerFocusGauge />);

    expect(screen.getByRole('button', { name: /Start Focus/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset/i })).toBeInTheDocument();
  });

  it('toggles start and pause state while playing chimes', () => {
    render(<WillpowerFocusGauge initialMinutes={10} />);

    const toggleBtn = screen.getByRole('button', { name: /Start Focus/i });
    fireEvent.click(toggleBtn);

    expect(toggleBtn.textContent).toBe('Pause');
    expect(mockStart).toHaveBeenCalled();

    fireEvent.click(toggleBtn);
    expect(toggleBtn.textContent).toBe('Start Focus');
  });

  it('counts down active timer every second and executes onComplete', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();

    render(<WillpowerFocusGauge initialMinutes={1} onComplete={onComplete} />);

    const toggleBtn = screen.getByRole('button', { name: /Start Focus/i });
    fireEvent.click(toggleBtn);

    // Advance 30 seconds
    act(() => {
      jest.advanceTimersByTime(30000);
    });

    const timer = screen.getByTestId('timer-display');
    expect(timer.textContent).toBe('00:30');

    // Advance remaining 30 seconds to hit 0
    act(() => {
      jest.advanceTimersByTime(30000);
    });

    expect(timer.textContent).toBe('00:00');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('resets timer back to total seconds when clicking reset', () => {
    jest.useFakeTimers();
    render(<WillpowerFocusGauge initialMinutes={5} />);

    const toggleBtn = screen.getByRole('button', { name: /Start Focus/i });
    fireEvent.click(toggleBtn);

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    const timer = screen.getByTestId('timer-display');
    expect(timer.textContent).toBe('04:50');

    const resetBtn = screen.getByRole('button', { name: /Reset/i });
    fireEvent.click(resetBtn);

    expect(timer.textContent).toBe('05:00');
    expect(toggleBtn.textContent).toBe('Start Focus');
  });

  it('updates timer when initialMinutes prop changes while inactive', () => {
    const { rerender } = render(<WillpowerFocusGauge initialMinutes={15} />);
    expect(screen.getByTestId('timer-display').textContent).toBe('15:00');

    rerender(<WillpowerFocusGauge initialMinutes={30} />);
    expect(screen.getByTestId('timer-display').textContent).toBe('30:00');
  });

  it('cleans up AudioContext on unmount', () => {
    const { unmount } = render(<WillpowerFocusGauge />);
    const toggleBtn = screen.getByRole('button', { name: /Start Focus/i });

    fireEvent.click(toggleBtn);
    expect(mockStart).toHaveBeenCalled();

    unmount();
    expect(mockClose).toHaveBeenCalled();
  });
});
