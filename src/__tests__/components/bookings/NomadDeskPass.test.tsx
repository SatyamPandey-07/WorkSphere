import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  buildDeskPassPngFilename,
  NomadDeskPass,
  sanitizeFilenameSegment,
} from '@/components/bookings/NomadDeskPass';

describe('NomadDeskPass PNG filename sanitization', () => {
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
      buildDeskPassPngFilename(
        'Bandra/West: Studio *1?',
        'CONF\\2026:01/02'
      )
    ).toBe('nomad-desk-pass-Bandra-West-Studio-1-CONF-2026-01-02.png');
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
});
