import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { addCalendarDays, BookingDatePicker, buildMonthCalendarDays, formatCalendarTuple, parseToCalendarTuple, tupleToNoonUtcDate } from '@/components/bookings/BookingDatePicker';
describe('BookingDatePicker DST boundary normalization', () => { it('anchors calendar tuples at noon UTC and steps across US spring-forward and fall-back DST boundaries without shifting days', () => { const beforeSpring = parseToCalendarTuple('2026-03-07', 'America/New_York'); const springDstDay = addCalendarDays(beforeSpring, 1); const afterSpring = addCalendarDays(springDstDay, 1); expect(formatCalendarTuple(springDstDay)).toBe('2026-03-08'); expect(formatCalendarTuple(afterSpring)).toBe('2026-03-09'); expect(tupleToNoonUtcDate(springDstDay).toISOString()).toBe('2026-03-08T12:00:00.000Z'); const beforeFall = parseToCalendarTuple('2026-10-31', 'America/New_York'); const fallDstDay = addCalendarDays(beforeFall, 1); const afterFall = addCalendarDays(fallDstDay, 1); expect(formatCalendarTuple(fallDstDay)).toBe('2026-11-01'); expect(formatCalendarTuple(afterFall)).toBe('2026-11-02'); expect(buildMonthCalendarDays(2026, 3)).toHaveLength(31); expect(buildMonthCalendarDays(2026, 11)).toHaveLength(30); }); it('renders and selects exact Y-M-D dates across DST boundaries without off-by-one shifts', () => { const handleChange = jest.fn(); render(<BookingDatePicker value="2026-03-08" monthDate="2026-03-01" timeZone="America/Los_Angeles" onChange={handleChange} />); const dstButton = screen.getByRole('button', { name: '8' }); expect(dstButton).toHaveAttribute('data-date', '2026-03-08'); expect(dstButton).toHaveAttribute('aria-pressed', 'true'); const nextDayButton = screen.getByRole('button', { name: '9' }); fireEvent.click(nextDayButton); expect(handleChange).toHaveBeenCalledWith('2026-03-09', { year: 2026, month: 3, day: 9 }); }); });
describe('BookingDatePicker today shortcut', () => {
  afterEach(() => jest.useRealTimers());

  it('navigates to and selects today using the configured timezone', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    const handleChange = jest.fn();
    render(<BookingDatePicker monthDate="2025-12-01" timeZone="America/Los_Angeles" onChange={handleChange} />);
    const picker = screen.getByTestId('booking-date-picker');
    picker.focus();
    fireEvent.keyDown(picker, { key: 'T' });
    expect(picker).toHaveAttribute('data-month', '2025-12');
    expect(handleChange).toHaveBeenCalledWith('2025-12-31', { year: 2025, month: 12, day: 31 });
  });

  it('does not fire outside the picker or from editable controls', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    const handleChange = jest.fn();
    render(<><input aria-label="outside" /><BookingDatePicker monthDate="2026-01-01" onChange={handleChange} /></>);
    fireEvent.keyDown(screen.getByLabelText('outside'), { key: 't' });
    expect(handleChange).not.toHaveBeenCalled();
    const picker = screen.getByTestId('booking-date-picker');
    const input = document.createElement('input');
    picker.appendChild(input);
    fireEvent.keyDown(input, { key: 't' });
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('leaves existing date navigation unchanged', () => {
    const handleChange = jest.fn();
    render(<BookingDatePicker monthDate="2026-06-01" onChange={handleChange} />);
    fireEvent.click(screen.getByRole('button', { name: '15' }));
    expect(handleChange).toHaveBeenCalledWith('2026-06-15', { year: 2026, month: 6, day: 15 });
  });
});
