import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@/components/venues/VenueSeatWaitlistModal', () => ({
  VenueSeatWaitlistModal: () => <div data-testid="mock-waitlist" />,
}));

jest.mock('@/lib/security/offlinePasscardStore', () => ({
  storeOfflinePasscardsFromBooking: jest.fn().mockResolvedValue(undefined),
}));

import { BookingModal } from '@/components/bookings/BookingModal';
import { storeOfflinePasscardsFromBooking } from '@/lib/security/offlinePasscardStore';

describe('BookingModal Component (#7725)', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;
  const mockConfirmationId = 'WS-BKG-84920';

  beforeEach(() => {
    jest.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
    document.execCommand = jest.fn().mockReturnValue(true);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
    document.execCommand = originalExecCommand;
  });

  it('preserves existing reservation form behavior when not confirmed', () => {
    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: /reserve workspace/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/time/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm booking/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('booking-confirmation-card'),
    ).not.toBeInTheDocument();
  });

  it('renders confirmation card with correct confirmation ID and CopyBookingReferenceButton', () => {
    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
        confirmationId={mockConfirmationId}
      />,
    );

    expect(
      screen.getByRole('heading', { name: /booking confirmed!/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('booking-confirmation-card')).toBeInTheDocument();
    expect(screen.getByTestId('booking-confirmation-id')).toHaveTextContent(
      mockConfirmationId,
    );

    const copyBtn = screen.getByTestId('copy-confirmation-btn');
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn).toHaveAttribute(
      'aria-label',
      `Copy booking confirmation reference ID ${mockConfirmationId}`,
    );
  });

  it('transitions to confirmation card and invokes onSuccess and offline passcard store upon successful submission', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { confirmationId: 'WS-BKG-99123', offlinePasscard: 'token-abc' },
      }),
    });

    const mockOnSuccess = jest.fn();
    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={jest.fn()}
        onSuccess={mockOnSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText(/date/i), {
      target: { value: '2026-12-01' },
    });
    fireEvent.change(screen.getByLabelText(/time/i), {
      target: { value: '14:00' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm booking/i }));
    });

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith('WS-BKG-99123');
    });

    expect(storeOfflinePasscardsFromBooking).toHaveBeenCalledWith({
      confirmationId: 'WS-BKG-99123',
      offlinePasscard: 'token-abc',
    });

    expect(screen.getByTestId('booking-confirmation-card')).toBeInTheDocument();
    expect(screen.getByTestId('booking-confirmation-id')).toHaveTextContent(
      'WS-BKG-99123',
    );
    expect(screen.getByTestId('copy-confirmation-btn')).toBeInTheDocument();
  });

  it('handles successful copying using the integrated CopyBookingReferenceButton', async () => {
    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
        confirmationId={mockConfirmationId}
      />,
    );

    const copyBtn = screen.getByTestId('copy-confirmation-btn');

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      mockConfirmationId,
    );
    expect(copyBtn).toHaveAttribute(
      'aria-label',
      `Booking reference ID ${mockConfirmationId} copied to clipboard`,
    );
    expect(screen.getByTestId('copy-sr-announcement')).toHaveTextContent(
      'Booking reference copied to clipboard',
    );
  });

  it('displays manual fallback with selectable input when copying fails', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });
    document.execCommand = jest.fn().mockImplementation(() => {
      throw new Error('execCommand failed');
    });

    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
        confirmationId={mockConfirmationId}
      />,
    );

    const copyBtn = screen.getByTestId('copy-confirmation-btn');

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(
      screen.getByTestId('clipboard-fallback-container'),
    ).toBeInTheDocument();
    const fallbackInput = screen.getByTestId(
      'fallback-confirmation-input',
    ) as HTMLInputElement;
    expect(fallbackInput).toBeInTheDocument();
    expect(fallbackInput.value).toBe(mockConfirmationId);
    expect(fallbackInput).toHaveAttribute('readonly');

    const selectSpy = jest.spyOn(fallbackInput, 'select');
    fireEvent.focus(fallbackInput);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('handles existing modal close behavior in both form and confirmation states', () => {
    const mockOnClose = jest.fn();
    const { rerender } = render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={mockOnClose}
        onSuccess={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('booking-modal-backdrop'));
    expect(mockOnClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(3);

    // Confirmation state close
    rerender(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={mockOnClose}
        onSuccess={jest.fn()}
        confirmationId={mockConfirmationId}
      />,
    );

    fireEvent.click(screen.getByTestId('booking-done-btn'));
    expect(mockOnClose).toHaveBeenCalledTimes(4);
  });

  it('displays validation error if date or time is missing when submitting', async () => {
    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm booking/i }));
    });

    expect(screen.getByTestId('booking-error-alert')).toHaveTextContent(
      'Please select both a date and time',
    );
  });
});
