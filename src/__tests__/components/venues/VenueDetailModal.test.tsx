import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { VenueDetailModal, VenueDetail } from '@/components/venues/VenueDetailModal';

describe('VenueDetailModal (Zero-CLS Reserved Hero Gallery)', () => {
  const sampleVenue: VenueDetail = {
    id: 'venue-cls-1',
    name: 'Third Wave Coffee Roasters',
    address: 'Baner Road, Pune',
    category: 'Work Cafe',
    rating: 4.7,
    reviewCount: 128,
    wifiSpeedMbps: 145,
    noiseDb: 48,
    outletDensity: 4,
    heroPhotoUrl: 'https://images.pexels.com/photos/12345/cafe-hero.jpeg',
    description: 'Bright corner seating with dedicated power strips and fiber Wi-Fi.',
  };

  test('reserves aspect-video container and displays skeleton shimmer until hero image finishes loading', () => {
    render(
      <VenueDetailModal
        venue={sampleVenue}
        isOpen={true}
        onClose={jest.fn()}
      />
    );

    const galleryContainer = screen.getByTestId('venue-hero-gallery-container');
    expect(galleryContainer.className).toContain('aspect-video');

    // Before image finishes downloading: skeleton shimmer is mounted and img is opacity-0
    const skeleton = screen.getByTestId('venue-hero-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton.className).toContain('animate-pulse');

    const img = screen.getByAltText(/Third Wave Coffee Roasters workspace preview/i);
    expect(img).toHaveAttribute('width', '1280');
    expect(img).toHaveAttribute('height', '720');
    expect(img.className).toContain('opacity-0');

    // Simulate network image load completion
    fireEvent.load(img);

    expect(screen.queryByTestId('venue-hero-skeleton')).not.toBeInTheDocument();
    expect(img.className).toContain('opacity-100');
  });

  test('renders fallback placeholder without collapsing gallery height when image fails to load', () => {
    render(
      <VenueDetailModal
        venue={sampleVenue}
        isOpen={true}
        onClose={jest.fn()}
      />
    );

    const img = screen.getByAltText(/Third Wave Coffee Roasters workspace preview/i);
    fireEvent.error(img);

    expect(screen.getByTestId('venue-hero-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('venue-hero-gallery-container').className).toContain(
      'aspect-video'
    );
  });
});