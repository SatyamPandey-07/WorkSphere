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
  amenities: {
    wifi: true,
    outlets: true,
    quiet: false,
  },
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

    expect(screen.getByText('WiFi')).toBeInTheDocument();
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

    expect(screen.getByText('Outlets')).toBeInTheDocument();
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

  it('calls onSaveFavorite when Save button is clicked', () => {
    render(
      <VenueCard
        venue={mockVenue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );

    fireEvent.click(screen.getByText('Save'));
    expect(mockOnSaveFavorite).toHaveBeenCalledWith(mockVenue);
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
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
  });
});
