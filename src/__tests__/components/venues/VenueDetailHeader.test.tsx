import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  VENUE_LINK_COPIED_TOAST,
  VenueDetailHeader,
} from '@/components/venues/VenueDetailHeader';

describe('VenueDetailHeader copy link & toast', () => {
  it('copies venue URL via Clipboard API and displays confirmation toast', async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    render(
      <VenueDetailHeader
        venueId="bandra-hub-42"
        venueName="WorkSphere Bandra Hub"
        neighborhood="Bandra West"
        city="Mumbai"
      />
    );

    fireEvent.click(screen.getByTestId('copy-venue-link-btn'));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        `${window.location.origin}/venues/bandra-hub-42`
      );
      expect(screen.getByTestId('toast-message').textContent).toBe(
        VENUE_LINK_COPIED_TOAST
      );
    });
  });

  it('falls back to document.execCommand("copy") when Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });

    const execCommandMock = jest.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: execCommandMock,
      configurable: true,
    });

    render(
      <VenueDetailHeader
        venueId="lower-parel-09"
        venueName="WorkSphere Lower Parel"
      />
    );

    fireEvent.click(screen.getByTestId('copy-venue-link-btn'));

    await waitFor(() => {
      expect(execCommandMock).toHaveBeenCalledWith('copy');
      expect(screen.getByTestId('toast-message').textContent).toBe(
        VENUE_LINK_COPIED_TOAST
      );
    });
  });
});
