import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BookingModal } from '@/components/bookings/BookingModal';

describe('BookingModal double-submit protection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disables button immediately, shows spinner, and dispatches only 1 POST request on rapid clicks', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const onSuccess = jest.fn();
    const onError = jest.fn();

    render(
      <BookingModal
        isOpen
        venueId="venue-mum-1"
        seatId="seat-12"
        onSuccess={onSuccess}
        onError={onError}
        onClose={() => {}}
      />
    );

    const button = screen.getByTestId('confirm-reservation-btn') as HTMLButtonElement;

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(screen.getByTestId('confirm-spinner')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/venues/venue-mum-1/seats/seat-12/lock',
      expect.objectContaining({ method: 'POST' })
    );

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ ok: true, lockId: 'lock-99' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ ok: true, lockId: 'lock-99' });
    });

    expect(onError).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });
});