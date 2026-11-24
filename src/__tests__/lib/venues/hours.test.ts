import React from 'react';
import { render, screen } from '@testing-library/react';
import { getVenueOpeningStatus, type VenueOpeningHours } from '@/lib/venues/hours';
import { VenueCard } from '@/components/venues/VenueCard';

describe('getVenueOpeningStatus & VenueCard badge', () => {
  const standardHours: VenueOpeningHours = {
    timeZone: 'Asia/Kolkata',
    schedule: {
      mon: [{ open: '09:00', close: '20:00' }],
      tue: [{ open: '09:00', close: '20:00' }],
      wed: [{ open: '09:00', close: '20:00' }],
      thu: [{ open: '09:00', close: '20:00' }],
      fri: [{ open: '09:00', close: '20:00' }],
      sat: [{ open: '10:00', close: '18:00' }],
      sun: [],
    },
  };

  it('returns Open Now during normal hours and Closing Soon within 60 minutes of close', () => {
    const openStatus = getVenueOpeningStatus(standardHours, '2026-11-24T09:00:00.000Z');
    expect(openStatus.state).toBe('open');
    expect(openStatus.badgeText).toBe('Open Now');

    const closingStatus = getVenueOpeningStatus(standardHours, '2026-11-24T13:45:00.000Z');
    expect(closingStatus.state).toBe('closing_soon');
    expect(closingStatus.badgeText).toBe('Closing Soon (Closes at 8:00 PM)');
  });

  it('returns Closed with next opening time across evenings and weekends', () => {
    const afterHours = getVenueOpeningStatus(standardHours, '2026-11-24T15:30:00.000Z');
    expect(afterHours.state).toBe('closed');
    expect(afterHours.badgeText).toBe('Closed (Opens tomorrow at 9:00 AM)');
  });

  it('handles 24/7 venues and overnight midnight crossovers', () => {
    const twentyFourSeven = getVenueOpeningStatus(
      { is24Seven: true, timeZone: 'Asia/Kolkata' },
      '2026-11-24T22:00:00.000Z'
    );
    expect(twentyFourSeven.badgeText).toBe('Open Now');

    const lateNightVenue: VenueOpeningHours = {
      timeZone: 'Asia/Kolkata',
      schedule: {
        tue: [{ open: '18:00', close: '02:00' }],
      },
    };
    const overnightStatus = getVenueOpeningStatus(lateNightVenue, '2026-11-24T19:30:00.000Z');
    expect(overnightStatus.state).toBe('open');
    expect(overnightStatus.badgeText).toBe('Open Now');
  });

  it('renders accessible status badge on VenueCard', () => {
    render(
      <VenueCard
        id="bandra-hub"
        name="WorkSphere Bandra Hub"
        neighborhood="Bandra West"
        openingHours={standardHours}
        currentTime="2026-11-24T13:45:00.000Z"
      />
    );

    const badge = screen.getByTestId('venue-opening-badge');
    expect(badge.textContent).toBe('Closing Soon (Closes at 8:00 PM)');
    expect(badge).toHaveAttribute('role', 'status');
  });
});
