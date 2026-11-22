import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  formatTravelDuration,
  haversineDistanceKm,
  TRANSIT_SPEED_KMH,
  VenueCard,
  WALKING_SPEED_KMH,
} from '@/components/venue/VenueCard';

describe('VenueCard travel estimates & Book now shortcut badge/tooltip', () => {
  const bhandupStation = { lat: 19.1695, lng: 72.9369 };
  const sampleVenue = {
    id: 'venue-1',
    name: 'Bhandup Hub Co-Work',
    address: 'LBS Marg, Bhandup West, Mumbai',
    lat: 19.1765,
    lng: 72.9395,
  };

  it('computes Haversine distance and renders walk/transit chips when userLocation is provided', () => {
    const km = haversineDistanceKm(bhandupStation, {
      lat: sampleVenue.lat,
      lng: sampleVenue.lng,
    });
    expect(km).toBeGreaterThan(0.7);
    expect(km).toBeLessThan(1.1);

    const expectedWalkMin = Math.max(1, Math.round((km / WALKING_SPEED_KMH) * 60));
    const expectedTransitMin = Math.max(1, Math.round((km / TRANSIT_SPEED_KMH) * 60));
    expect(expectedWalkMin).toBeGreaterThan(expectedTransitMin);
    expect(formatTravelDuration(75)).toBe('1h 15m');

    render(<VenueCard venue={sampleVenue} userLocation={bhandupStation} />);
    expect(screen.getByTestId('venue-walk-chip')).toHaveTextContent(/min walk/);
    expect(screen.getByTestId('venue-transit-chip')).toHaveTextContent(/min transit/);
  });

  it('renders default [B] hotkey badge during keyboard navigation and shows ShortcutTooltip on focus/hover', () => {
    render(<VenueCard venue={sampleVenue} />);

    const bookBtn = screen.getByTestId('venue-book-now-btn');
    expect(bookBtn).toHaveAttribute('aria-keyshortcuts', 'B');
    expect(screen.queryByTestId('venue-book-hotkey-badge')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByTestId('venue-book-hotkey-badge')).toHaveTextContent('[B]');

    fireEvent.focus(bookBtn);
    const tooltip = screen.getByTestId('shortcut-tooltip');
    expect(tooltip).toHaveTextContent('Book now');
    expect(tooltip).toHaveTextContent('B');

    fireEvent.blur(bookBtn);
    expect(screen.queryByTestId('shortcut-tooltip')).not.toBeInTheDocument();
  });

  it('supports custom bookingHotkey and gracefully disables tooltip/badge when bookingHotkey={null}', () => {
    const onBookNow = jest.fn();
    const { rerender } = render(
      <VenueCard
        venue={sampleVenue}
        bookingHotkey="r"
        isKeyboardNavigationActive
        onBookNow={onBookNow}
      />
    );

    const bookBtn = screen.getByTestId('venue-book-now-btn');
    expect(bookBtn).toHaveAttribute('aria-keyshortcuts', 'R');
    expect(screen.getByTestId('venue-book-hotkey-badge')).toHaveTextContent('[R]');

    fireEvent.click(bookBtn);
    expect(onBookNow).toHaveBeenCalledWith(sampleVenue);

    rerender(
      <VenueCard
        venue={sampleVenue}
        bookingHotkey={null}
        isKeyboardNavigationActive
      />
    );

    expect(screen.getByTestId('venue-book-now-btn')).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.queryByTestId('venue-book-hotkey-badge')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('venue-book-now-btn'));
    expect(screen.queryByTestId('shortcut-tooltip')).not.toBeInTheDocument();
  });
});