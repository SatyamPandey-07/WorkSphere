import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toPng } from 'html-to-image';
import {
  getOfflinePasscardRecord,
  saveOfflinePasscard,
} from '@/lib/security/offlinePasscardStore';
import {
  buildDeskPassPngFilename,
  NomadDeskPass,
  resolveVenueLocationSubtitle,
  sanitizeFilenameSegment,
  type NomadDeskBooking,
} from '@/components/bookings/NomadDeskPass';
jest.mock('@/lib/security/offlinePasscardStore', () => ({
  getOfflinePasscardRecord: jest.fn().mockImplementation(() => new Promise(() => {})),
  saveOfflinePasscard: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('html-to-image', () => ({
  toPng: jest.fn(),
}));

describe('NomadDeskPass Location Subtitle and Neighborhood Fallback', () => {
  const baseBooking: NomadDeskBooking = {
    id: 'test-booking-1',
    confirmationId: 'CONF-10628',
    date: '2026-11-26',
    time: '10:00 AM',
    seatNumber: '04',
    venue: {
      name: 'Central Nomad Hub',
      address: '123 Market Street, Suite 400',
      city: 'San Francisco',
      neighborhood: 'Financial District',
      tags: ['Coworking', 'Hi-Speed WiFi'],
    },
  };

  it('displays the existing address when venue.address is available', () => {
    render(<NomadDeskPass booking={baseBooking} isOpen={true} />);

    const locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toBeInTheDocument();
    expect(locationElem).toHaveTextContent('123 Market Street, Suite 400');
  });

  it('displays city or neighborhood fallback when address is missing or empty', () => {
    const bookingWithNeighborhood: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Bandra Workspace',
        address: '',
        neighborhood: 'Bandra West',
        city: 'Mumbai',
      },
    };

    render(<NomadDeskPass booking={bookingWithNeighborhood} isOpen={true} />);

    const locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toBeInTheDocument();
    expect(locationElem).toHaveTextContent('Bandra West, Mumbai');
  });

  it('displays single neighborhood or city tag fallback appropriately', () => {
    const bookingOnlyNeighborhood: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'SoHo Collective',
        address: null,
        neighborhood: 'SoHo',
      },
    };

    const { rerender } = render(
      <NomadDeskPass booking={bookingOnlyNeighborhood} isOpen={true} />
    );

    let locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toHaveTextContent('SoHo');

    const bookingOnlyCity: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Kyoto Station Loft',
        address: undefined,
        city: 'Kyoto',
      },
    };

    rerender(<NomadDeskPass booking={bookingOnlyCity} isOpen={true} />);
    locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toHaveTextContent('Kyoto');

    const bookingWithTagFallback: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Alpine Work Hub',
        address: '',
        city: '',
        neighborhood: '',
        tags: ['Zermatt Alpine District'],
      },
    };

    rerender(<NomadDeskPass booking={bookingWithTagFallback} isOpen={true} />);
    locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toHaveTextContent('Zermatt Alpine District');
  });

  it('does not render broken or undefined text when both address and location fallbacks are unavailable', () => {
    const bookingNoLocation: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Secret Workspace',
        address: null,
        neighborhood: null,
        city: null,
        tags: null,
      },
    };

    render(<NomadDeskPass booking={bookingNoLocation} isOpen={true} />);

    const locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toBeInTheDocument();
    expect(locationElem).not.toHaveTextContent('undefined');
    expect(locationElem).not.toHaveTextContent('null');
    expect(locationElem).toHaveTextContent('');
  });

  it('maintains a stable subtitle container to prevent layout shift between address and fallback', () => {
    const { container, rerender } = render(
      <NomadDeskPass booking={baseBooking} isOpen={true} />
    );

    const locationWithAddress = screen.getByTestId('nomad-desk-pass-location');
    expect(locationWithAddress).toHaveClass('min-h-[1.5rem]');
    expect(locationWithAddress).toHaveClass('text-sm');

    const bookingFallback: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Central Nomad Hub',
        address: '',
        neighborhood: 'Financial District',
      },
    };

    rerender(<NomadDeskPass booking={bookingFallback} isOpen={true} />);
    const locationWithFallback = screen.getByTestId('nomad-desk-pass-location');
    expect(locationWithFallback).toHaveClass('min-h-[1.5rem]');
    expect(locationWithFallback).toHaveClass('text-sm');
  });
});

describe('NomadDeskPass PNG filename sanitization and export', () => {
  it('strips or replaces invalid path characters across Windows/macOS and handles Unicode/empty inputs', () => {
    expect(sanitizeFilenameSegment('Bandra / West \\ Hub: A*B?C')).toBe(
      'Bandra-West-Hub-A-B-C'
    );
    expect(sanitizeFilenameSegment('Café Powai — Studio')).toBe(
      'Cafe-Powai-Studio'
    );
    expect(sanitizeFilenameSegment('   ', 'fallback-venue')).toBe(
      'fallback-venue'
    );
    expect(sanitizeFilenameSegment('', 'fallback-id')).toBe('fallback-id');

    expect(
      buildDeskPassPngFilename('Bandra/West: Studio *1?', 'CONF\\2026:01/02')
    ).toBe('nomad-desk-pass-Bandra-West-Studio-1-CONF-2026-01-02.png');
  });

  it('handles emoji-only, punctuation-only, and symbol-only venue names with safe deterministic fallbacks', () => {
    // Emoji-only venue names
    expect(sanitizeFilenameSegment('🏢✨', 'worksphere-venue')).toBe('worksphere-venue');
    expect(sanitizeFilenameSegment('🚀🌟🎉')).toBe('pass');
    expect(buildDeskPassPngFilename('🏢✨', 'CONF-100')).toBe(
      'nomad-desk-pass-worksphere-venue-CONF-100.png'
    );

    // Punctuation-only and symbol-only venue names
    expect(sanitizeFilenameSegment('???!!!...', 'worksphere-venue')).toBe('worksphere-venue');
    expect(sanitizeFilenameSegment('---___...', 'worksphere-venue')).toBe('worksphere-venue');
    expect(sanitizeFilenameSegment('$$$%%%@@@###')).toBe('pass');
    expect(buildDeskPassPngFilename('!@#$%^&*()', 'ABC-999')).toBe(
      'nomad-desk-pass-worksphere-venue-ABC-999.png'
    );

    // Mixed emoji / punctuation with valid characters preserves valid segment
    expect(sanitizeFilenameSegment('🏢 Studio 42 ✨')).toBe('Studio-42');
    expect(buildDeskPassPngFilename('🏢 Studio 42 ✨', 'CONF-42')).toBe(
      'nomad-desk-pass-Studio-42-CONF-42.png'
    );

    // Normal venue names remain correctly sanitized
    expect(sanitizeFilenameSegment('WeWork Innovation Hub')).toBe(
      'WeWork-Innovation-Hub'
    );
    expect(buildDeskPassPngFilename('WeWork Innovation Hub', 'CONF-12345')).toBe(
      'nomad-desk-pass-WeWork-Innovation-Hub-CONF-12345.png'
    );

    // Ensure generated PNG filenames never contain an empty venue-name segment
    const emptyVenueResult = buildDeskPassPngFilename('', 'CONF-001');
    expect(emptyVenueResult).toBe('nomad-desk-pass-worksphere-venue-CONF-001.png');
    expect(emptyVenueResult).not.toContain('--CONF-001.png');
  });

  it('passes sanitized PNG filename when clicking Download PNG', () => {
    const onDownloadPng = jest.fn();
    render(
      <NomadDeskPass
        venueName="Andheri / East * Loft?"
        confirmationId="WS:99/01"
        onDownloadPng={onDownloadPng}
      />
    );

    fireEvent.click(screen.getByTestId('download-pass-png-btn'));
    expect(onDownloadPng).toHaveBeenCalledTimes(1);
    expect(onDownloadPng.mock.calls[0]?.[0]).toBe(
      'nomad-desk-pass-Andheri-East-Loft-WS-99-01.png'
    );
  });
  it('keeps the QR and PNG download available when offline passcard caching exceeds storage quota', async () => {
    const originalFetch = global.fetch;
    const onDownloadPng = jest.fn();

    (getOfflinePasscardRecord as jest.Mock).mockResolvedValueOnce(null);
    (saveOfflinePasscard as jest.Mock).mockRejectedValueOnce(
      new DOMException('Storage quota exceeded', 'QuotaExceededError')
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ offlinePasscard: 'fresh-test-passcard-token' }),
    }) as typeof fetch;

    try {
      render(
        <NomadDeskPass
          venueName="Andheri Workspace"
          confirmationId="WS-QUOTA-01"
          onDownloadPng={onDownloadPng}
        />
      );

      expect(await screen.findByTestId('nomad-desk-pass-qr')).toBeInTheDocument();

      await waitFor(() => {
        expect(saveOfflinePasscard).toHaveBeenCalledWith(
          'fresh-test-passcard-token'
        );
      });

      fireEvent.click(screen.getByTestId('download-pass-png-btn'));
      expect(onDownloadPng).toHaveBeenCalledTimes(1);
      expect(onDownloadPng.mock.calls[0]?.[0]).toBe(
        'nomad-desk-pass-Andheri-Workspace-WS-QUOTA-01.png'
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('NomadDeskPass confirmation ID copy action', () => {
  const booking: NomadDeskBooking = {
    id: 'copy-test-booking',
    confirmationId: 'CONF-Exact/42',
    date: '2026-11-27',
    time: '10:00 AM',
    venue: { name: 'Copy Test Workspace' },
  };

  function restoreClipboard(
    descriptor: PropertyDescriptor | undefined,
  ) {
    if (descriptor) {
      Object.defineProperty(navigator, 'clipboard', descriptor);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  }

  it('copies the exact confirmation ID and shows success feedback', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      'clipboard',
    );
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(<NomadDeskPass booking={booking} />);
      const copyButton = screen.getByRole('button', {
        name: 'Copy confirmation ID',
      });

      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('CONF-Exact/42');
      });
      expect(copyButton).toHaveTextContent('Copied');
      expect(screen.getByRole('status')).toHaveTextContent(
        'Confirmation ID copied.',
      );
    } finally {
      restoreClipboard(originalClipboard);
    }
  });

  it('shows visible feedback when clipboard access fails', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      'clipboard',
    );
    const writeText = jest.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(<NomadDeskPass booking={booking} />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Copy confirmation ID' }),
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not copy confirmation ID. Copy it manually.',
      );
      expect(
        screen.getByRole('button', { name: 'Copy confirmation ID' }),
      ).toHaveTextContent('Copy failed');
    } finally {
      restoreClipboard(originalClipboard);
    }
  });
});

describe('NomadDeskPass PNG export retry', () => {
  it('shows an accessible error and retries the current passcard after toPng rejects', async () => {
    const toPngMock = toPng as jest.MockedFunction<typeof toPng>;
    toPngMock
      .mockReset()
      .mockRejectedValueOnce(new Error('Canvas export failed'))
      .mockResolvedValueOnce('data:image/png;base64,recovered');
    (getOfflinePasscardRecord as jest.Mock).mockResolvedValueOnce({
      token: 'cached-passcard-token',
    });
    const anchorClick = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const initialBooking: NomadDeskBooking = {
      id: 'retry-test-booking',
      confirmationId: 'CONF-RETRY-01',
      date: '2026-11-27',
      time: '10:00 AM',
      venue: { name: 'Retry Workspace' },
    };
    const { rerender } = render(<NomadDeskPass booking={initialBooking} />);

    try {
      const downloadButton = await screen.findByTestId('download-pass-png-btn');
      await waitFor(() => expect(downloadButton).toBeEnabled());
      fireEvent.click(downloadButton);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not export the pass as an image. Please try again.',
      );
      expect(toPngMock).toHaveBeenCalledTimes(1);

      const updatedBooking: NomadDeskBooking = {
        ...initialBooking,
        confirmationId: 'CONF-RETRY-UPDATED',
      };
      rerender(<NomadDeskPass booking={updatedBooking} />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Retry PNG export' }),
      );

      await waitFor(() => {
        expect(toPngMock).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
      const retriedCard = toPngMock.mock.calls[1]?.[0];
      expect(retriedCard).toBeDefined();
      expect(retriedCard?.textContent).toContain('CONF-RETRY-UPDATED');
      expect(anchorClick).toHaveBeenCalledTimes(1);
    } finally {
      anchorClick.mockRestore();
    }
  });
});
