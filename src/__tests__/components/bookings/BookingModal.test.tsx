import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BookingModal } from '@/components/bookings/BookingModal';

describe('BookingModal dismissal guards during in-flight submission', () => {
  it('ignores backdrop clicks and Escape key while isSubmitting or loading is true', () => {
    const onClose = jest.fn();

    const { rerender } = render(
      <BookingModal isOpen isSubmitting onClose={onClose} />
    );

    const backdrop = screen.getByTestId('booking-modal-backdrop');
    fireEvent.click(backdrop);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();

    rerender(<BookingModal isOpen isSubmitting={false} loading onClose={onClose} />);
    fireEvent.click(backdrop);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows backdrop click and Escape dismissal when idle', () => {
    const onClose = jest.fn();

    render(<BookingModal isOpen isSubmitting={false} loading={false} onClose={onClose} />);

    const dialog = screen.getByTestId('booking-modal-dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByTestId('booking-modal-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});