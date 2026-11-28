import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BookingModal } from '@/components/bookings/BookingModal';

describe('BookingModal dismissal guards during in-flight submission', () => {
 fix/next-16-upgrade-and-api-exports
  it('blocks backdrop click, Escape key, close button, and cancel button while submitting or loading', () => {

  it('ignores backdrop clicks and Escape key while isSubmitting or loading is true', () => {
 main
    const onClose = jest.fn();

    const { rerender } = render(
      <BookingModal isOpen isSubmitting onClose={onClose} />
    );

 fix/next-16-upgrade-and-api-exports
    expect(screen.getByTestId('booking-modal-busy-hint')).toBeInTheDocument();
    expect(screen.getByTestId('booking-modal-close-btn')).toBeDisabled();
    expect(screen.getByTestId('booking-modal-cancel-btn')).toBeDisabled();

    fireEvent.click(screen.getByTestId('booking-modal-backdrop'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('booking-modal-close-btn'));
    fireEvent.click(screen.getByTestId('booking-modal-cancel-btn'));
    expect(onClose).not.toHaveBeenCalled();

    rerender(<BookingModal isOpen isSubmitting={false} loading onClose={onClose} />);
    fireEvent.click(screen.getByTestId('booking-modal-backdrop'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows backdrop click and Escape dismissal once submission completes', () => {

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

 fix/next-16-upgrade-and-api-exports
    fireEvent.click(screen.getByTestId('booking-modal-dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('booking-modal-backdrop'));

    const dialog = screen.getByTestId('booking-modal-dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByTestId('booking-modal-backdrop');
    fireEvent.click(backdrop);
 main
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});