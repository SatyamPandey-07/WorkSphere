import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VenueFilterBar } from '@/components/venues/VenueFilterBar';

describe('VenueFilterBar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('toggles amenity chips, updates aria-pressed, and preserves existing query params', () => {
    const onQueryParamsChange = jest.fn();
    render(
      <VenueFilterBar
        existingSearchParams="q=Bandra&sort=rating"
        onQueryParamsChange={onQueryParamsChange}
      />
    );

    const petChip = screen.getByTestId('venue-filter-chip-dogFriendly');
    expect(petChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(petChip);
    expect(petChip).toHaveAttribute('aria-pressed', 'true');
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      'q=Bandra&sort=rating&amenities=dogFriendly&dogFriendly=true'
    );

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(screen.getByTestId('venue-filter-live-region').textContent).toBe(
      '1 amenity filter active.'
    );
  });
});
