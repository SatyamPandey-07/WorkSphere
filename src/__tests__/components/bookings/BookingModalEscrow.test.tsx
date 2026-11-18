import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  BookingModal,
  getEscrowStatusLabel,
  type EscrowConfirmationStatus,
} from '@/components/bookings/BookingModal';

jest.mock('@/components/venues/VenueSeatWaitlistModal', () => ({
  VenueSeatWaitlistModal: () => <div data-testid="mock-waitlist" />,
}));

jest.mock('@/lib/security/offlinePasscardStore', () => ({
  storeOfflinePasscardsFromBooking: jest.fn().mockResolvedValue(undefined),
}));

const MOCK_SIGNATURE =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJkLSzLj699';
const MOCK_BOOKING_ID = 'bkg_escrow_12345';

describe('BookingModal Escrow Confirmation Streaming (#7773)', () => {
  let originalEventSource: any;
  let mockEventSourceInstances: MockEventSource[] = [];

  class MockEventSource {
    url: string;
    listeners: Record<string, Array<(e: any) => void>> = {};
    readyState = 0;
    close = jest.fn();

    constructor(url: string) {
      this.url = url;
      mockEventSourceInstances.push(this);
    }

    addEventListener(event: string, handler: (e: any) => void) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(handler);
    }

    emit(event: string, data: any) {
      const handlers = this.listeners[event] || [];
      for (const h of handlers) {
        h({ data: JSON.stringify(data) });
      }
    }
  }

  beforeAll(() => {
    originalEventSource = (window as any).EventSource;
    (window as any).EventSource = MockEventSource;
  });

  afterAll(() => {
    (window as any).EventSource = originalEventSource;
  });

  beforeEach(() => {
    mockEventSourceInstances = [];
    jest.clearAllMocks();
  });

  it('renders progressive confirmation states in the loading overlay with accessibility attributes', () => {
    const statuses: EscrowConfirmationStatus[] = [
      'pending',
      'processed',
      'confirmed',
      'fallback_polling',
    ];

    for (const status of statuses) {
      const { unmount } = render(
        <BookingModal
          venueId="venue-1"
          venueName="Silicon Loft"
          onClose={jest.fn()}
          onSuccess={jest.fn()}
          escrowSignature={MOCK_SIGNATURE}
          escrowStatus={status}
        />,
      );

      const overlay = screen.getByTestId('booking-loading-overlay');
      expect(overlay).toBeInTheDocument();
      expect(overlay).toHaveAttribute('role', 'status');
      expect(overlay).toHaveAttribute('aria-live', 'polite');

      const expectedLabel = getEscrowStatusLabel(status);
      expect(screen.getByTestId('booking-loading-message')).toHaveTextContent(
        expectedLabel,
      );

      const statusBadge = screen.getByTestId('escrow-confirmation-status');
      expect(statusBadge).toHaveTextContent(status);

      unmount();
    }
  });

  it('displays error alert with retry button when escrow status is failed', () => {
    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
        escrowSignature={MOCK_SIGNATURE}
        escrowStatus="failed"
      />,
    );

    // Overlay should not be visible when failed
    expect(screen.queryByTestId('booking-loading-overlay')).not.toBeInTheDocument();

    // Alert should display error
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByTestId('booking-error-alert')).toHaveTextContent(
      /escrow transaction failed/i,
    );
    expect(screen.getByTestId('booking-retry-btn')).toBeInTheDocument();
  });

  it('displays error alert when escrow status is timeout', () => {
    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
        escrowSignature={MOCK_SIGNATURE}
        escrowStatus="timeout"
      />,
    );

    expect(screen.queryByTestId('booking-loading-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-error-alert')).toHaveTextContent(
      /confirmation timed out/i,
    );
  });

  it('subscribes to SSE streaming and transitions status from pending to finalized', async () => {
    const onEscrowStatusChange = jest.fn();
    const onSuccess = jest.fn();

    render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        bookingId={MOCK_BOOKING_ID}
        escrowSignature={MOCK_SIGNATURE}
        onClose={jest.fn()}
        onSuccess={onSuccess}
        onEscrowStatusChange={onEscrowStatusChange}
      />,
    );

    expect(mockEventSourceInstances.length).toBe(1);
    const es = mockEventSourceInstances[0];
    expect(es.url).toContain(`/api/pay/solana?bookingId=${MOCK_BOOKING_ID}`);
    expect(es.url).toContain(`signature=${MOCK_SIGNATURE}`);

    // Initially pending
    expect(screen.getByTestId('booking-loading-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('escrow-confirmation-status')).toHaveTextContent(
      'pending',
    );

    // 1. Emit processed
    act(() => {
      es.emit('status', { status: 'processed' });
    });
    expect(onEscrowStatusChange).toHaveBeenCalledWith('processed');
    expect(screen.getByTestId('escrow-confirmation-status')).toHaveTextContent(
      'processed',
    );

    // 2. Emit confirmed
    act(() => {
      es.emit('status', { status: 'confirmed' });
    });
    expect(onEscrowStatusChange).toHaveBeenCalledWith('confirmed');
    expect(onSuccess).toHaveBeenCalledWith(MOCK_BOOKING_ID);

    // 3. Emit finalized
    act(() => {
      es.emit('status', { status: 'finalized' });
    });
    expect(onEscrowStatusChange).toHaveBeenCalledWith('finalized');
    expect(es.close).toHaveBeenCalled();

    // Renders confirmed card with escrow badge
    expect(screen.getByTestId('booking-confirmation-card')).toBeInTheDocument();
    expect(screen.getByTestId('escrow-status-card')).toBeInTheDocument();
    expect(screen.getByTestId('escrow-confirmation-status')).toHaveTextContent(
      'finalized',
    );
  });

  it('closes SSE connection on unmount', () => {
    const { unmount } = render(
      <BookingModal
        venueId="venue-1"
        venueName="Silicon Loft"
        bookingId={MOCK_BOOKING_ID}
        escrowSignature={MOCK_SIGNATURE}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    expect(mockEventSourceInstances.length).toBe(1);
    const es = mockEventSourceInstances[0];

    unmount();
    expect(es.close).toHaveBeenCalledTimes(1);
  });

  it('integrates full production booking flow: reservation -> deposit signature -> SSE streaming -> confirmed card', async () => {
    // 1. Setup mock reservation API response
    const mockBookingData = {
      id: MOCK_BOOKING_ID,
      confirmationId: 'WS-SOL-998877',
      venueId: 'venue-production-1',
      status: 'PENDING',
    };

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/bookings') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockBookingData }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });

    try {
      const onSuccess = jest.fn();
      const onEscrowStatusChange = jest.fn();

      // 2. Render initial BookingModal for venue
      const { rerender } = render(
        <BookingModal
          venueId="venue-production-1"
          venueName="Silicon Oasis Hub"
          onClose={jest.fn()}
          onSuccess={onSuccess}
          onEscrowStatusChange={onEscrowStatusChange}
        />,
      );

      // Initial state: form is rendered with Date & Time inputs and Confirm Booking button
      const confirmBtn = screen.getByRole('button', { name: /confirm booking/i });
      expect(confirmBtn).toBeInTheDocument();

      // Select date and time
      const dateInput = document.getElementById('booking-date-input') as HTMLInputElement;
      const timeInput = document.getElementById('booking-time-input') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2026-11-20' } });
      fireEvent.change(timeInput, { target: { value: '10:00' } });

      // 3. User submits reservation
      await act(async () => {
        fireEvent.click(confirmBtn);
      });

      // Reservation succeeds, sets confirmed ID
      expect(onSuccess).toHaveBeenCalledWith(mockBookingData.confirmationId);

      // 4. Wallet broadcasts escrow transaction and initiates confirmation monitoring with escrowSignature
      rerender(
        <BookingModal
          venueId="venue-production-1"
          venueName="Silicon Oasis Hub"
          bookingId={mockBookingData.id}
          confirmationId={mockBookingData.confirmationId}
          escrowSignature={MOCK_SIGNATURE}
          onClose={jest.fn()}
          onSuccess={onSuccess}
          onEscrowStatusChange={onEscrowStatusChange}
        />,
      );

      // Verify EventSource connected to SSE streaming endpoint
      expect(mockEventSourceInstances.length).toBe(1);
      const es = mockEventSourceInstances[0];
      expect(es.url).toContain(`/api/pay/solana?bookingId=${mockBookingData.id}`);
      expect(es.url).toContain(`signature=${MOCK_SIGNATURE}`);

      // 5. Stream emits fallback_polling when cluster has high latency
      act(() => {
        es.emit('status', {
          status: 'fallback_polling',
          source: 'http_polling',
        });
      });
      expect(onEscrowStatusChange).toHaveBeenCalledWith('fallback_polling');

      // 6. Stream emits finalized on cluster finality
      act(() => {
        es.emit('status', {
          status: 'finalized',
          source: 'websocket',
        });
      });
      expect(onEscrowStatusChange).toHaveBeenCalledWith('finalized');
      expect(es.close).toHaveBeenCalled();

      // Verify final confirmed state
      expect(screen.getByTestId('booking-confirmation-card')).toBeInTheDocument();
      expect(screen.getByTestId('booking-confirmation-id')).toHaveTextContent(
        mockBookingData.confirmationId,
      );
      expect(screen.getByTestId('escrow-status-card')).toBeInTheDocument();
      expect(screen.getByTestId('escrow-confirmation-status')).toHaveTextContent('finalized');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
