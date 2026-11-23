import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  formatTravelDuration,
  haversineDistanceKm,
  TRANSIT_SPEED_KMH,
  VenueCard,
  WALKING_SPEED_KMH,
} from '@/components/venue/VenueCard';

describe('VenueCard travel time estimates & chips', () => {
  const bhandupStation = { lat: 19.1695, lng: 72.9369 };
  const sampleVenue = {
    id: 'venue-1',
    name: 'Bhandup Hub Co-Work',
    address: 'LBS Marg, Bhandup West, Mumbai',
    lat: 19.1765,
    lng: 72.9395,
  };

  it('computes Haversine distance and walk/transit estimates accurately', () => {
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
    expect(formatTravelDuration(120)).toBe('2h');
  });

  it('renders walk and transit chips beside the venue address when userLocation is provided', () => {
    render(<VenueCard venue={sampleVenue} userLocation={bhandupStation} />);

    expect(screen.getByTestId('venue-address')).toHaveTextContent(
      'LBS Marg, Bhandup West, Mumbai'
    );
    expect(screen.getByTestId('venue-travel-chips')).toBeInTheDocument();
    expect(screen.getByTestId('venue-walk-chip')).toHaveTextContent(/min walk/);
    expect(screen.getByTestId('venue-transit-chip')).toHaveTextContent(/min transit/);
  });

  it('hides travel chips gracefully when userLocation is missing or null', () => {
    const { rerender } = render(<VenueCard venue={sampleVenue} />);
    expect(screen.queryByTestId('venue-travel-chips')).not.toBeInTheDocument();

    rerender(<VenueCard venue={sampleVenue} userLocation={null} />);
    expect(screen.queryByTestId('venue-travel-chips')).not.toBeInTheDocument();
  });
});