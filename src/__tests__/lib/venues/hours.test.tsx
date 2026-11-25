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

  it('correctly identifies cross-midnight operating windows (20:00-04:00 and 17:00-01:00)', () => {
    // 20:00 - 04:00 schedule on Friday night / Saturday morning in UTC
    const clubVenue: VenueOpeningHours = {
      timeZone: 'UTC',
      schedule: {
        fri: [{ open: '20:00', close: '04:00' }],
      },
    };

    // Friday at 22:00 UTC (open)
    const friNight = getVenueOpeningStatus(clubVenue, '2026-11-27T22:00:00.000Z');
    expect(friNight.state).toBe('open');
    expect(friNight.badgeText).toBe('Open Now');

    // Saturday at 01:15 UTC (cross-midnight window, open)
    const satEarly = getVenueOpeningStatus(clubVenue, '2026-11-28T01:15:00.000Z');
    expect(satEarly.state).toBe('open');
    expect(satEarly.badgeText).toBe('Open Now');
    expect(satEarly.closesAtFormatted).toBe('4:00 AM');

    // Saturday at 03:15 UTC (closing soon, < 60 min remaining)
    const satClosingSoon = getVenueOpeningStatus(clubVenue, '2026-11-28T03:15:00.000Z');
    expect(satClosingSoon.state).toBe('closing_soon');
    expect(satClosingSoon.badgeText).toBe('Closing Soon (Closes at 4:00 AM)');

    // Saturday at 04:15 UTC (closed)
    const satAfterClose = getVenueOpeningStatus(clubVenue, '2026-11-28T04:15:00.000Z');
    expect(satAfterClose.state).toBe('closed');

    // 17:00 - 01:00 schedule
    const loungeVenue: VenueOpeningHours = {
      timeZone: 'UTC',
      schedule: {
        fri: [{ open: '17:00', close: '01:00' }],
      },
    };

    // Friday at 23:30 UTC (open)
    const loungeBeforeMidnight = getVenueOpeningStatus(loungeVenue, '2026-11-27T23:30:00.000Z');
    expect(loungeBeforeMidnight.state).toBe('open');
    expect(loungeBeforeMidnight.badgeText).toBe('Open Now');

    // Saturday at 00:20 UTC (cross-midnight, closing soon within 40 min)
    const loungeAfterMidnight = getVenueOpeningStatus(loungeVenue, '2026-11-28T00:20:00.000Z');
    expect(loungeAfterMidnight.state).toBe('closing_soon');
    expect(loungeAfterMidnight.badgeText).toBe('Closing Soon (Closes at 1:00 AM)');

    // Saturday at 01:05 UTC (closed)
    const loungeClosed = getVenueOpeningStatus(loungeVenue, '2026-11-28T01:05:00.000Z');
    expect(loungeClosed.state).toBe('closed');
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
