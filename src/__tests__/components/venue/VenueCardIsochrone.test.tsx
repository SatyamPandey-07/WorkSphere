import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { VenueCard } from '@/components/venue/VenueCard';

describe('VenueCard Walking Isochrone Overlay (Issue #9610)', () => {
  const userLocation = { lat: 19.1695, lng: 72.9369 };
  const sampleVenue = {
    id: 'venue-101',
    name: 'Bhandup Hub Co-Work',
    address: 'LBS Marg, Bhandup West, Mumbai',
    lat: 19.1765,
    lng: 72.9395,
  };

  test('renders isochrone map and 5/10/15 min controls when userLocation is present', () => {
    render(<VenueCard venue={sampleVenue} userLocation={userLocation} />);

    expect(screen.getByTestId('venue-isochrone-section')).toBeInTheDocument();
    expect(screen.getByTestId('isochrone-preset-controls')).toBeInTheDocument();
    expect(screen.getByTestId('isochrone-preset-5')).toBeInTheDocument();
    expect(screen.getByTestId('isochrone-preset-10')).toBeInTheDocument();
    expect(screen.getByTestId('isochrone-preset-15')).toBeInTheDocument();

    // Default selection is 5 min
    expect(screen.getByTestId('isochrone-preset-5')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('isochrone-preset-10')).toHaveAttribute('aria-pressed', 'false');

    // SVG polygon overlay renders cleanly
    expect(screen.getByTestId('venue-isochrone-map')).toBeInTheDocument();
    expect(screen.getByTestId('isochrone-polygon')).toBeInTheDocument();
    expect(screen.getByTestId('user-location-pin')).toBeInTheDocument();
    expect(screen.getByTestId('venue-location-pin')).toBeInTheDocument();
  });

  test('updates isochrone polygon immediately when preset changes', () => {
    render(<VenueCard venue={sampleVenue} userLocation={userLocation} />);

    const polyBefore = screen.getByTestId('isochrone-polygon').getAttribute('points');
    expect(polyBefore).toBeTruthy();

    // Click 10 min preset
    fireEvent.click(screen.getByTestId('isochrone-preset-10'));

    expect(screen.getByTestId('isochrone-preset-10')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('isochrone-preset-5')).toHaveAttribute('aria-pressed', 'false');

    const poly10 = screen.getByTestId('isochrone-polygon').getAttribute('points');
    expect(poly10).not.toBe(polyBefore);

    // Click 15 min preset
    fireEvent.click(screen.getByTestId('isochrone-preset-15'));
    expect(screen.getByTestId('isochrone-preset-15')).toHaveAttribute('aria-pressed', 'true');

    const poly15 = screen.getByTestId('isochrone-polygon').getAttribute('points');
    expect(poly15).not.toBe(poly10);
  });

  test('displays friendly location access message when userLocation is missing or null without crashing', () => {
    render(<VenueCard venue={sampleVenue} userLocation={null} />);

    // Should not crash, and should display location access message
    expect(screen.getByTestId('isochrone-gps-required')).toBeInTheDocument();
    expect(screen.getByText(/Location access is required/i)).toBeInTheDocument();
    expect(screen.queryByTestId('venue-isochrone-map')).not.toBeInTheDocument();
    expect(screen.queryByTestId('isochrone-polygon')).not.toBeInTheDocument();

    // Venue card info remains intact
    expect(screen.getByText('Bhandup Hub Co-Work')).toBeInTheDocument();
    expect(screen.getByTestId('venue-address')).toHaveTextContent('LBS Marg, Bhandup West, Mumbai');
  });
});
