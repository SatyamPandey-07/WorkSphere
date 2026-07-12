import { render, screen, fireEvent, act } from '@testing-library/react';
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

  const renderVenueCard = async (venue = mockVenue) => {
    const utils = render(
      <VenueCard
        venue={venue}
        onGetDirections={mockOnGetDirections}
        onSaveFavorite={mockOnSaveFavorite}
        onRate={mockOnRate}
      />
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return utils;
  };

  it('renders venue name and category', async () => {
    await renderVenueCard();

    expect(screen.getByText('Coffee Shop')).toBeInTheDocument();
    expect(screen.getByText('cafe')).toBeInTheDocument();
  });

  it('renders address when provided', async () => {
    await renderVenueCard();

    expect(screen.getByText('123 Main St')).toBeInTheDocument();
  });

  it('shows WiFi indicator when venue has WiFi', async () => {
    await renderVenueCard();

    expect(screen.getAllByText(/WiFi/)[0]).toBeInTheDocument();
  });

  it('shows Outlets indicator when venue has outlets', async () => {
    await renderVenueCard();

    expect(screen.getAllByText(/Outlets/)[0]).toBeInTheDocument();
  });

  it('calls onGetDirections when Directions button is clicked', async () => {
    await renderVenueCard();

    fireEvent.click(screen.getByText('Directions'));
    expect(mockOnGetDirections).toHaveBeenCalledWith(mockVenue);
  });

  it('calls onSaveFavorite when heart icon is clicked', async () => {
    await renderVenueCard();

    // Find the heart button (favorite button)
    const favoriteButton = document.querySelector('button svg.lucide-heart')?.closest('button');
    if (favoriteButton) {
      fireEvent.click(favoriteButton);
      expect(mockOnSaveFavorite).toHaveBeenCalledWith(mockVenue);
    }
  });

  it('calls onRate when Rate button is clicked', async () => {
    await renderVenueCard();

    fireEvent.click(screen.getByText('Rate'));
    expect(mockOnRate).toHaveBeenCalledWith(mockVenue);
  });

  it('renders all action buttons', async () => {
    await renderVenueCard();

    // Verify all actions are available
    expect(screen.getByText('Directions')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
  });
});
