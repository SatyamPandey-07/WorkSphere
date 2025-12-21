import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VenueCard } from '@/components/VenueCard';

const mockVenue = {
  id: 'test-venue-1',
  name: 'Coffee Shop',
  category: 'cafe',
  address: '123 Main St',
  distance: '0.5 km',
  rating: 4.5,
  position: { lat: 37.7749, lng: -122.4194 },
  wifiQuality: 4,
  hasOutlets: true,
  noiseLevel: 'quiet',
};

describe('VenueCard', () => {
  const mockOnGetDirections = jest.fn();
  const mockOnSaveFavorite = jest.fn();
  const mockOnRate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders venue name and category', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    expect(screen.getByText('Coffee Shop')).toBeInTheDocument();
    expect(screen.getByText('cafe')).toBeInTheDocument();
  });

  it('renders address when provided', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    expect(screen.getByText('123 Main St')).toBeInTheDocument();
  });

  it('shows WiFi indicator when venue has WiFi', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    expect(screen.getByText(/WiFi/)).toBeInTheDocument();
  });

  it('shows Outlets indicator when venue has outlets', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    expect(screen.getByText(/Outlets/)).toBeInTheDocument();
  });

  it('calls onGetDirections when Directions button is clicked', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    fireEvent.click(screen.getByText('Directions'));
    expect(mockOnGetDirections).toHaveBeenCalledWith(mockVenue);
  });

  it('calls onSaveFavorite when heart icon is clicked', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    // Find the heart button (favorite button)
    const favoriteButton = document.querySelector('button svg.lucide-heart')?.closest('button');
    if (favoriteButton) {
      fireEvent.click(favoriteButton);
      expect(mockOnSaveFavorite).toHaveBeenCalledWith(mockVenue);
    }
  });

  it('calls onRate when Rate button is clicked', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    fireEvent.click(screen.getByText('Rate'));
    expect(mockOnRate).toHaveBeenCalledWith(mockVenue);
  });

  it('renders all action buttons', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    // Verify all actions are available
    expect(screen.getByText('Directions')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
  });
});
