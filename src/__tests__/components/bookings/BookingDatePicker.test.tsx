import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookingDatePicker } from '@/components/bookings/BookingDatePicker';
import { getDatePreset } from '@/lib/validations/dateFilter';

describe('BookingDatePicker presets (#9755 & #9885)', () => {
  it('renders Today, Tomorrow, This Weekend, and Next Monday preset buttons with accessible attributes', () => {
    render(<BookingDatePicker />);

    const todayBtn = screen.getByTestId('date-preset-today');
    const tomorrowBtn = screen.getByTestId('date-preset-tomorrow');
    const weekendBtn = screen.getByTestId('date-preset-weekend');
    const nextMondayBtn = screen.getByTestId('date-preset-next-monday');

    expect(todayBtn).toBeInTheDocument();
    expect(tomorrowBtn).toBeInTheDocument();
    expect(weekendBtn).toBeInTheDocument();
    expect(nextMondayBtn).toBeInTheDocument();

    expect(todayBtn).toHaveAttribute('aria-pressed', 'false');
    expect(tomorrowBtn).toHaveAttribute('aria-pressed', 'false');
    expect(weekendBtn).toHaveAttribute('aria-pressed', 'false');
    expect(nextMondayBtn).toHaveAttribute('aria-pressed', 'false');

    expect(nextMondayBtn).toHaveTextContent('Next Monday');
  });

  it('updates date and triggers callbacks when clicking Today', () => {
    const onDateChange = jest.fn();
    const onChange = jest.fn();
    render(<BookingDatePicker onDateChange={onDateChange} onChange={onChange} />);

    const todayBtn = screen.getByTestId('date-preset-today');
    fireEvent.click(todayBtn);

    const { startDate, endDate } = getDatePreset('today');
    expect(todayBtn).toHaveAttribute('aria-pressed', 'true');
    expect(todayBtn).toHaveClass('bg-violet-600');
    expect(onDateChange).toHaveBeenCalledWith(startDate);
    expect(onChange).toHaveBeenCalledWith({ startDate, endDate });
  });

  it('updates date and triggers callbacks when clicking Tomorrow', () => {
    const onDateChange = jest.fn();
    render(<BookingDatePicker onDateChange={onDateChange} />);

    const tomorrowBtn = screen.getByTestId('date-preset-tomorrow');
    fireEvent.click(tomorrowBtn);

    const { startDate } = getDatePreset('tomorrow');
    expect(tomorrowBtn).toHaveAttribute('aria-pressed', 'true');
    expect(tomorrowBtn).toHaveClass('bg-violet-600');
    expect(onDateChange).toHaveBeenCalledWith(startDate);
  });

  it('updates date and triggers callbacks when clicking This Weekend', () => {
    const onDateChange = jest.fn();
    const onChange = jest.fn();
    render(<BookingDatePicker onDateChange={onDateChange} onChange={onChange} />);

    const weekendBtn = screen.getByTestId('date-preset-weekend');
    fireEvent.click(weekendBtn);

    const { startDate, endDate } = getDatePreset('weekend');
    expect(weekendBtn).toHaveAttribute('aria-pressed', 'true');
    expect(weekendBtn).toHaveClass('bg-violet-600');
    expect(onDateChange).toHaveBeenCalledWith(startDate);
    expect(onChange).toHaveBeenCalledWith({ startDate, endDate });
  });

  it('updates date and triggers callbacks when clicking Next Monday (#9885)', () => {
    const onDateChange = jest.fn();
    const onChange = jest.fn();
    render(<BookingDatePicker onDateChange={onDateChange} onChange={onChange} />);

    const nextMondayBtn = screen.getByTestId('date-preset-next-monday');
    fireEvent.click(nextMondayBtn);

    const { startDate, endDate } = getDatePreset('nextMonday');
    expect(nextMondayBtn).toHaveAttribute('aria-pressed', 'true');
    expect(nextMondayBtn).toHaveClass('bg-violet-600');
    expect(onDateChange).toHaveBeenCalledWith(startDate);
    expect(onChange).toHaveBeenCalledWith({ startDate, endDate });

    // Input value updates to Next Monday
    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input.value).toBe(startDate);
  });

  it('clears active preset when a non-matching manual date is input', () => {
    render(<BookingDatePicker />);

    const todayBtn = screen.getByTestId('date-preset-today');
    fireEvent.click(todayBtn);
    expect(todayBtn).toHaveAttribute('aria-pressed', 'true');

    const input = screen.getByLabelText('Date') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2099-01-01' } });

    expect(todayBtn).toHaveAttribute('aria-pressed', 'false');
    expect(todayBtn).not.toHaveClass('bg-violet-600');
  });

  it('disables buttons when disabled prop is true', () => {
    render(<BookingDatePicker disabled />);

    expect(screen.getByTestId('date-preset-today')).toBeDisabled();
    expect(screen.getByTestId('date-preset-tomorrow')).toBeDisabled();
    expect(screen.getByTestId('date-preset-weekend')).toBeDisabled();
    expect(screen.getByTestId('date-preset-next-monday')).toBeDisabled();
    expect(screen.getByLabelText('Date')).toBeDisabled();
  });
});
